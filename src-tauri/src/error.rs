//! Errors as the frontend shows them: a message key of `i18n/locales` for what this app says
//! itself, and the text of the driver or the operating system for what they report.

use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct AppError {
    /// Key of the message; absent when `detail` is the whole message.
    key: Option<&'static str>,
    /// Goes into the `{detail}` placeholder of the message.
    detail: Option<String>,
}

impl AppError {
    pub fn key(key: &'static str) -> Self {
        Self { key: Some(key), detail: None }
    }

    pub fn with_detail(key: &'static str, detail: impl ToString) -> Self {
        Self { key: Some(key), detail: Some(detail.to_string()) }
    }

    /// An error of the driver or the system, shown as it is.
    pub fn raw(detail: impl ToString) -> Self {
        Self { key: None, detail: Some(detail.to_string()) }
    }
}

impl From<mongodb::error::Error> for AppError {
    fn from(error: mongodb::error::Error) -> Self {
        Self::raw(error)
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::raw(error)
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::raw(error)
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
