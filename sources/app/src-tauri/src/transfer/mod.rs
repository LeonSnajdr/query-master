//! The export and import wizards: collections into files (JSON, CSV, SQL), the clipboard or another
//! database, and files into collections. Documents go from the cursor to the file and from the file
//! to the server in batches, never through the web view, so their size is limited by the disk, not
//! by the window.

pub mod commands;
mod csv_format;
mod csv_import;
mod import_job;
mod job;
mod json_format;
mod shell_reader;
mod sql_format;
