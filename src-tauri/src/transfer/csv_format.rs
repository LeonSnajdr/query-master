//! CSV: a column per chosen field (dotted paths reach into sub documents); without a choice one per
//! field of the first level, those of the first batch in the order they first appear, and a field
//! seen only later is reported, not written. Nested values are written as relaxed extended JSON.

use std::collections::BTreeSet;
use std::io::Write;

use mongodb::bson::{Bson, Document};
use serde::Deserialize;

use crate::error::{Error, Result};

/// The settings of the CSV page.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvOptions {
    pub delimiter: char,
    /// What wraps a value holding the delimiter, a quote or a line break.
    pub quote: char,
    pub header: bool,
    /// `null` as an empty cell; otherwise the word `null`.
    pub null_empty: bool,
    /// Line breaks in text as `\r` and `\n`, so every document stays on one line.
    pub escape_strings: bool,
}

impl Default for CsvOptions {
    fn default() -> Self {
        Self {
            delimiter: ',',
            quote: '"',
            header: true,
            null_empty: true,
            escape_strings: false,
        }
    }
}

pub struct CsvWriter<W: Write> {
    writer: csv::Writer<W>,
    options: CsvOptions,
    columns: Option<Vec<String>>,
    /// The header's names of the columns, when they differ from the paths.
    names: Option<Vec<String>>,
    /// The columns were chosen: fields outside them are left out, not reported.
    chosen: bool,
    skipped: BTreeSet<String>,
}

impl<W: Write> CsvWriter<W> {
    /// With `columns` (dotted paths, as `customer.name`) the file has exactly these, in order.
    pub fn with_options(file: W, options: CsvOptions, columns: Option<Vec<String>>) -> Self {
        let writer = csv::WriterBuilder::new()
            .delimiter(u8::try_from(options.delimiter).unwrap_or(b','))
            .quote(u8::try_from(options.quote).unwrap_or(b'"'))
            // CRLF and Excel expect.
            .terminator(csv::Terminator::CRLF)
            .from_writer(file);
        let chosen = columns.as_ref().is_some_and(|columns| !columns.is_empty());
        Self {
            writer,
            options,
            columns: columns.filter(|columns| !columns.is_empty()),
            chosen,
            names: None,
            skipped: BTreeSet::new(),
        }
    }

    pub fn write(&mut self, documents: &[Document]) -> Result<()> {
        if self.columns.is_none() {
            self.columns = Some(columns_of(documents));
        }
        let columns = self.columns.as_ref().expect("set above");
        if self.options.header {
            match self
                .names
                .as_ref()
                .filter(|names| names.len() == columns.len())
            {
                Some(names) => self.writer.write_record(names),
                None => self.writer.write_record(columns),
            }
            .map_err(csv_error)?;
            // Once, before the first row.
            self.options.header = false;
        }
        for document in documents {
            if !self.chosen {
                for key in document.keys() {
                    if !columns.contains(key) {
                        self.skipped.insert(key.clone());
                    }
                }
            }
            let record = columns.iter().map(|column| {
                path_value(document, column)
                    .map(|value| cell_with(value, &self.options))
                    .unwrap_or_default()
            });
            self.writer.write_record(record).map_err(csv_error)?;
        }
        Ok(())
    }

    /// Names for the header, one per chosen column (renamed on the schema page).
    pub fn with_names(mut self, names: Option<Vec<String>>) -> Self {
        self.names = names;
        self
    }

    pub fn finish(mut self) -> Result<Vec<String>> {
        self.writer.flush()?;
        Ok(self.skipped.into_iter().collect())
    }

    /// The writer underneath, flushed: the bytes of a CSV written into memory.
    pub fn into_inner(self) -> Result<W> {
        self.writer
            .into_inner()
            .map_err(|error| Error::Io(std::io::Error::other(error.to_string())))
    }
}

fn csv_error(error: csv::Error) -> Error {
    Error::Io(std::io::Error::other(error))
}

/// The fields of the first level, in the order they first appear.
pub(super) fn columns_of(documents: &[Document]) -> Vec<String> {
    let mut columns: Vec<String> = Vec::new();
    for document in documents {
        for key in document.keys() {
            if !columns.contains(key) {
                columns.push(key.clone());
            }
        }
    }
    columns
}

/// The value at a dotted path: through sub documents, and through arrays by position.
pub(super) fn path_value<'a>(document: &'a Document, path: &str) -> Option<&'a Bson> {
    if let Some(value) = document.get(path) {
        return Some(value);
    }
    let mut segments = path.split('.');
    let mut value = document.get(segments.next()?)?;
    for segment in segments {
        value = match value {
            Bson::Document(inner) => inner.get(segment)?,
            Bson::Array(items) => items.get(segment.parse::<usize>().ok()?)?,
            _ => return None,
        };
    }
    Some(value)
}

fn cell_with(value: &Bson, options: &CsvOptions) -> String {
    match value {
        Bson::Null if !options.null_empty => "null".into(),
        Bson::String(text) if options.escape_strings => text
            .replace('\\', "\\\\")
            .replace('\r', "\\r")
            .replace('\n', "\\n"),
        other => cell(other),
    }
}

/// A value as the text of a cell: plain for scalars, JSON for the rest.
fn cell(value: &Bson) -> String {
    match value {
        Bson::String(text) => text.clone(),
        Bson::Int32(number) => number.to_string(),
        Bson::Int64(number) => number.to_string(),
        // `inf` is Rust's spelling; the shell write `Infinity`.
        Bson::Double(number) if number.is_infinite() => if number.is_sign_positive() {
            "Infinity"
        } else {
            "-Infinity"
        }
        .into(),
        Bson::Double(number) => number.to_string(),
        Bson::Decimal128(number) => number.to_string(),
        Bson::Boolean(flag) => flag.to_string(),
        Bson::Null | Bson::Undefined => String::new(),
        Bson::ObjectId(id) => id.to_hex(),
        Bson::DateTime(date) => date
            .try_to_rfc3339_string()
            .unwrap_or_else(|_| date.timestamp_millis().to_string()),
        other => other.clone().into_relaxed_extjson().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId, DateTime};
    use std::fs::File;
    use std::io::BufWriter;

    #[test]
    fn writes_the_columns_chosen_with_the_settings_of_the_page() {
        let path =
            std::env::temp_dir().join(format!("querymaster-{}-options.csv", std::process::id()));
        let options = CsvOptions {
            delimiter: ';',
            quote: '\'',
            header: true,
            null_empty: false,
            escape_strings: true,
        };
        let columns = vec![
            "name".to_owned(),
            "customer.city".to_owned(),
            "tags.1".to_owned(),
            "gone".to_owned(),
        ];
        let mut writer = CsvWriter::with_options(
            BufWriter::new(File::create(&path).unwrap()),
            options,
            Some(columns),
        );
        writer
            .write(&[doc! { "name": "a;b", "customer": { "city": "Ulm" }, "tags": ["x", "y"], "other": 1 }])
            .unwrap();
        writer
            .write(&[doc! { "name": "line\nbreak", "customer": null }])
            .unwrap();
        // Chosen columns: fields left out are no surprise and not reported.
        assert!(writer.finish().unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "name;customer.city;tags.1;gone\r\n'a;b';Ulm;y;\r\nline\\nbreak;;;\r\n"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn writes_the_names_given_in_the_header() {
        let mut writer = CsvWriter::with_options(
            Vec::new(),
            CsvOptions::default(),
            Some(vec!["_id".into(), "customer.city".into()]),
        )
        .with_names(Some(vec!["id".into(), "Stadt".into()]));
        writer
            .write(&[doc! { "_id": 1, "customer": { "city": "Ulm" } }])
            .unwrap();
        let bytes = writer.into_inner().unwrap();
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            "id,Stadt\r\n1,Ulm\r\n"
        );
    }

    #[test]
    fn writes_cells_and_quotes_what_needs_it() {
        let path =
            std::env::temp_dir().join(format!("querymaster-{}-cells.csv", std::process::id()));
        let id = ObjectId::parse_str("64b7f0c2a1b2c3d4e5f60718").unwrap();
        let mut writer = CsvWriter::with_options(
            BufWriter::new(File::create(&path).unwrap()),
            CsvOptions::default(),
            None,
        );
        writer
            .write(&[
                doc! { "_id": id, "name": "Anna, \"A\"", "at": DateTime::from_millis(0) },
                doc! { "_id": 2, "tags": ["a", 1], "name": "line\nbreak" },
            ])
            .unwrap();
        writer.write(&[doc! { "_id": 3, "late": true }]).unwrap();
        assert_eq!(writer.finish().unwrap(), ["late"]);

        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(
            text,
            "_id,name,at,tags\r\n64b7f0c2a1b2c3d4e5f60718,\"Anna, \"\"A\"\"\",1970-01-01T00:00:00Z,\r\n2,\"line\nbreak\",,\"[\"\"a\"\",1]\"\r\n3,,,\r\n"
        );
        std::fs::remove_file(path).unwrap();
    }
}
