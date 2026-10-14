//! One error type for all commands. What this app says itself reaches the frontend as a message
//! key of `i18n/locales`; what the driver, SQLite or the operating system report, as their text.

use serde::ser::SerializeStruct;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("this connection is not open")]
    NotConnected,
    #[error("a connection string starts with mongodb:// or mongodb+srv://")]
    UriScheme,
    #[error("a command is a document")]
    CommandDocument,
    #[error("invalid extended JSON: {0}")]
    ExtendedJson(String),
    #[error("the keychain could not be used: {0}")]
    Keychain(#[source] keyring::Error),
    #[error("the connection string could not be read from the keychain: {0}")]
    KeychainRead(#[source] keyring::Error),
    #[error("the connection string could not be stored in the keychain: {0}")]
    KeychainWrite(#[source] keyring::Error),
    #[error("this tab is read-only")]
    ReadOnly,
    #[error("the script was stopped")]
    ScriptStopped,
    #[error("the copy was stopped")]
    CopyStopped,
    #[error("there is no collection {0}")]
    CollectionMissing(String),
    #[error("the export or import was stopped")]
    TransferStopped,
    #[error("a file to import holds documents: an array of them, one, or one per line")]
    ImportShape,
    #[error("{0}")]
    Script(String),
    #[error("the local database reported an error: {0}")]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Mongo(#[from] mongodb::error::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

impl Error {
    /// Key of the message the frontend shows; `None` when the text of the cause is the message.
    fn key(&self) -> Option<&'static str> {
        match self {
            Self::NotConnected => Some("error.backend.notConnected"),
            Self::UriScheme => Some("error.backend.uriScheme"),
            Self::CommandDocument => Some("error.backend.commandDocument"),
            Self::ExtendedJson(_) => Some("error.backend.extendedJson"),
            Self::Keychain(_) => Some("error.backend.keychain"),
            Self::KeychainRead(_) => Some("error.backend.keychainRead"),
            Self::KeychainWrite(_) => Some("error.backend.keychainWrite"),
            Self::Database(_) => Some("error.backend.database"),
            Self::ReadOnly => Some("error.plan.readonly"),
            Self::ScriptStopped => Some("error.script.stopped"),
            Self::CopyStopped => Some("error.copy.stopped"),
            Self::CollectionMissing(_) => Some("error.copy.missing"),
            Self::TransferStopped => Some("error.transfer.stopped"),
            Self::ImportShape => Some("error.transfer.shape"),
            Self::Mongo(_) | Self::Io(_) | Self::Script(_) => None,
        }
    }

    /// What goes into the `{detail}` placeholder of the message: the cause, without this app's words.
    fn detail(&self) -> Option<String> {
        match self {
            Self::NotConnected
            | Self::UriScheme
            | Self::CommandDocument
            | Self::ReadOnly
            | Self::ScriptStopped
            | Self::CopyStopped
            | Self::TransferStopped
            | Self::ImportShape => None,
            Self::CollectionMissing(name) => Some(name.clone()),
            Self::Script(message) => Some(message.clone()),
            Self::ExtendedJson(cause) => Some(cause.clone()),
            Self::Keychain(cause) | Self::KeychainRead(cause) | Self::KeychainWrite(cause) => {
                Some(cause.to_string())
            }
            Self::Database(cause) => Some(cause.to_string()),
            Self::Mongo(cause) => Some(cause.to_string()),
            Self::Io(cause) => Some(cause.to_string()),
        }
    }
}

/// Tauri sends a command's error to the frontend as JSON: `{ key, detail }`.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        let mut state = serializer.serialize_struct("Error", 2)?;
        state.serialize_field("key", &self.key())?;
        state.serialize_field("detail", &self.detail())?;
        state.end()
    }
}

#[cfg(test)]
mod tests {
    use super::Error;
    use serde_json::json;

    #[test]
    fn serializes_as_key_and_detail() {
        assert_eq!(
            serde_json::to_value(Error::NotConnected).unwrap(),
            json!({ "key": "error.backend.notConnected", "detail": null })
        );
        assert_eq!(
            serde_json::to_value(Error::ExtendedJson("bad".into())).unwrap(),
            json!({ "key": "error.backend.extendedJson", "detail": "bad" })
        );
        let io = Error::from(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "no such file",
        ));
        assert_eq!(
            serde_json::to_value(io).unwrap(),
            json!({ "key": null, "detail": "no such file" })
        );
    }
}
