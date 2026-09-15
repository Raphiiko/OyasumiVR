use super::*;

fn process(pid: u32, created: u64, parent: u32, bytes: u64) -> Process {
    Process {
        id: Identity { pid, created },
        parent,
        name: "fixture.exe".into(),
        private: Some(bytes),
        resident: Some(bytes),
        error: None,
    }
}

#[test]
fn discovers_grandchildren_and_retains_orphans_without_following_reused_pids() {
    let root = process(1, 10, 0, 0);
    let child = process(2, 20, 1, 0);
    let grandchild = process(3, 30, 2, 0);
    let unrelated = process(4, 5, 1, 0);
    let all = [grandchild.clone(), unrelated, child.clone(), root.clone()];
    let found = descendants(&all, &HashSet::from([root.id]));
    assert_eq!(found, HashSet::from([root.id, child.id, grandchild.id]));
    let replacement = process(2, 40, 99, 0);
    let new_child = process(5, 50, 2, 0);
    assert_eq!(
        descendants(
            &[root.clone(), grandchild.clone(), replacement, new_child],
            &found
        ),
        HashSet::from([root.id, grandchild.id])
    );
}

#[test]
fn triggers_only_after_sustained_per_process_or_aggregate_growth() {
    let start = Instant::now();
    let mut trigger = Trigger::default();
    let large = process(1, 10, 0, 2 * GIB);
    assert_eq!(trigger.check(&[large.clone()], start), None);
    assert_eq!(
        trigger.check(&[large.clone()], start + Duration::from_secs(14)),
        None
    );
    assert_eq!(
        trigger.check(&[large.clone()], start + Duration::from_secs(15)),
        Some(large.id)
    );
    let small = process(1, 10, 0, GIB);
    assert_eq!(
        trigger.check(&[small], start + Duration::from_secs(16)),
        None
    );
    assert_eq!(
        trigger.check(&[large], start + Duration::from_secs(17)),
        None
    );

    let mut trigger = Trigger::default();
    let spread = [
        process(1, 10, 0, GIB),
        process(2, 20, 1, GIB),
        process(3, 30, 2, GIB + 1),
        process(4, 40, 1, GIB),
    ];
    assert_eq!(trigger.check(&spread, start), None);
    assert_eq!(
        trigger.check(&spread, start + Duration::from_secs(15)),
        Some(spread[2].id)
    );
}

#[test]
fn inaccessible_samples_and_process_restarts_reset_the_trigger() {
    let start = Instant::now();
    let mut trigger = Trigger::default();
    let mut p = process(1, 10, 0, 2 * GIB);
    trigger.check(&[p.clone()], start);
    p.private = None;
    assert_eq!(
        trigger.check(&[p.clone()], start + Duration::from_secs(16)),
        None
    );
    p.private = Some(2 * GIB);
    assert_eq!(
        trigger.check(&[p.clone()], start + Duration::from_secs(17)),
        None
    );
    p.id.created += 1;
    assert_eq!(trigger.check(&[p], start + Duration::from_secs(40)), None);
}

#[test]
fn records_memory_from_windows_and_rejects_wrong_creation_time() {
    let id = native::identity(std::process::id()).unwrap();
    let mut p = process(id.pid, id.created, 0, 0);
    native::measure(&mut p);
    assert!(p.private.unwrap() > 0);
    assert!(p.resident.unwrap() > 0);
    assert!(p.error.is_none());
    assert!(native::root_handle(Identity {
        created: id.created + 1,
        ..id
    })
    .is_err());
}

#[test]
fn history_rotates_instead_of_growing_indefinitely() {
    let dir = std::env::temp_dir().join(format!(
        "oyasumivr-memory-watch-rotation-{}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("history.jsonl"),
        vec![b' '; HISTORY_LIMIT as usize],
    )
    .unwrap();
    record(&dir, &[], None).unwrap();
    assert_eq!(
        fs::metadata(dir.join("history.previous.jsonl"))
            .unwrap()
            .len(),
        HISTORY_LIMIT
    );
    assert!(fs::metadata(dir.join("history.jsonl")).unwrap().len() < 256);
    fs::remove_file(dir.join("history.previous.jsonl")).unwrap();
    fs::remove_file(dir.join("history.jsonl")).unwrap();
    fs::remove_dir(dir).unwrap();
}

#[test]
fn all_diagnostic_copy_is_available() {
    for key in ["consent", "enabled", "notification", "instructions"] {
        assert!(!text(key).is_empty());
    }
}

#[test]
fn oversized_targets_leave_a_report_without_starting_a_dump() {
    let dir = std::env::temp_dir().join(format!(
        "oyasumivr-memory-watch-budget-{}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    let process = process(42, 10, 1, 9 * GIB);
    let error = capture(&dir, process.id, &[process], "test-beta", &dir).unwrap_err();
    assert!(error.to_string().contains("budget"));
    let incident = dir.join("incident");
    let report: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(incident.join("report.json")).unwrap()).unwrap();
    assert_eq!(report["target"]["pid"], 42);
    assert!(fs::read_to_string(incident.join("instructions.txt"))
        .unwrap()
        .contains("PID 42"));
    assert!(!incident.join("process.dmp").exists());
    for name in ["report.json", "instructions.txt", "status.txt"] {
        fs::remove_file(incident.join(name)).unwrap();
    }
    fs::remove_dir(incident).unwrap();
    fs::remove_dir(dir).unwrap();
}
