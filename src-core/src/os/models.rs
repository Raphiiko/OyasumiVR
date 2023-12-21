use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct Output {
    pub stdout: String,
    pub stderr: String,
    pub status: i32,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct WindowsPowerPolicy {
    pub guid: String,
    pub name: String,
}
