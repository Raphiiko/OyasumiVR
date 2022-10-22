use std::{
    fs::File,
    io::{BufRead, BufReader},
};

#[tauri::command]
pub async fn read_text_from_file(path: String, skip_lines: usize) -> Option<String> {
    let input = File::open(path).unwrap();
    let buffered = BufReader::new(input);
    let lines = buffered
        .lines()
        .skip(skip_lines)
        .map(|line| line.unwrap())
        .collect::<Vec<String>>();
    if lines.len() > 0 { Some(lines.join("\n")) } else { None }
}
