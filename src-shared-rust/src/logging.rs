use std::{io, path::Path};

use flexi_logger::{
    Cleanup, Criterion, Duplicate, FileSpec, FlexiLoggerError, LogSpecification, Logger, Naming,
};
use log::Record;
use time::{macros::format_description, OffsetDateTime};

pub const MAX_LOG_FILE_SIZE: u64 = 1024 * 1024;
pub const MAX_RETAINED_LOG_FILES: usize = 14;

const ROTATED_FILE_NAME_FORMAT: &str = "%Y-%m-%d_%H-%M-%S";
const EMPTY_INFIX: &str = "";

pub fn init(
    log_dir: &Path,
    basename: &str,
    duplicate_to_stderr: bool,
) -> Result<(), FlexiLoggerError> {
    std::fs::create_dir_all(log_dir)?;
    let mut logger = Logger::with(LogSpecification::info())
        .log_to_file(
            FileSpec::default()
                .directory(log_dir)
                .basename(basename)
                .suppress_timestamp(),
        )
        .rotate(
            Criterion::Size(MAX_LOG_FILE_SIZE),
            Naming::TimestampsCustomFormat {
                current_infix: Some(EMPTY_INFIX),
                format: ROTATED_FILE_NAME_FORMAT,
            },
            Cleanup::KeepLogFiles(MAX_RETAINED_LOG_FILES - 1),
        )
        .format_for_files(log_line)
        .append()
        .cleanup_in_background_thread(false);
    if duplicate_to_stderr {
        logger = logger.duplicate_to_stderr(Duplicate::Info);
    }
    logger.start().map(|_| ())
}

pub fn log_line(
    write: &mut dyn io::Write,
    _now: &mut flexi_logger::DeferredNow,
    record: &Record,
) -> io::Result<()> {
    const FORMAT: &[time::format_description::FormatItem] =
        format_description!("[[[year]-[month]-[day]][[[hour]:[minute]:[second]]");
    write!(
        write,
        "{} [{}] {}",
        OffsetDateTime::now_utc().format(FORMAT).unwrap_or_default(),
        record.level(),
        record.args()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use flexi_logger::DeferredNow;
    use log::Level;

    #[test]
    fn log_lines_include_utc_date_time_and_level() {
        let mut now = DeferredNow::new();
        let record = Record::builder()
            .level(Level::Info)
            .args(format_args!("[run] started the sidecar"))
            .build();
        let mut bytes = Vec::new();
        log_line(&mut bytes, &mut now, &record).unwrap();
        let line = String::from_utf8(bytes).unwrap();
        let shape: String = line[..22]
            .chars()
            .map(|c| if c.is_ascii_digit() { '#' } else { c })
            .collect();
        assert_eq!(shape, "[####-##-##][##:##:##]");
        assert_eq!(&line[22..], " [INFO] [run] started the sidecar");
    }

    #[test]
    fn init_writes_to_the_named_file() {
        let dir = std::env::temp_dir()
            .join("oyasumivr-log-test")
            .join(std::process::id().to_string());
        let _ = std::fs::remove_dir_all(&dir);
        init(&dir, "Sidecar", false).unwrap();
        log::info!("test line");
        assert!(dir.join("Sidecar.log").is_file());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
