//! CSV into documents, with the settings of the import pages: delimiter, quote, rows
//! to skip, what an empty field becomes, field names from the first row, unescaping. Each column
//! has a name (a dotted path makes sub documents) and a type; a column can be left out.

use std::fs::File;
use std::path::Path;
use std::str::FromStr;

use mongodb::bson::{oid::ObjectId, Bson, Decimal128, Document};
use serde::{Deserialize, Serialize};

use super::shell_reader::parse_date;
use crate::error::{Error, Result};

/// Rows the preview shows, and reads to guess the types.
const PREVIEW_ROWS: usize = 10;
const GUESS_ROWS: usize = 200;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EmptyFields {
    Null,
    EmptyString,
    /// The field is left out of the document.
    Omit,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvReadOptions {
    pub delimiter: char,
    pub quote: char,
    /// Rows before the data (or before the row of names).
    pub skip_rows: usize,
    pub empty: EmptyFields,
    /// The first row (after the skipped ones) names the fields.
    pub header: bool,
    /// `\r`, `\n`, `\t`, `\\` in a field become the characters.
    pub unescape: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColumnType {
    /// A number, a boolean, or text, whatever the field looks like.
    Auto,
    String,
    Int,
    Long,
    Double,
    Decimal,
    Bool,
    Date,
    ObjectId,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: ColumnType,
    pub include: bool,
}

/// What the schema page shows of a file: its columns with a guessed type, and the first rows.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub columns: Vec<ImportColumn>,
    pub rows: Vec<Vec<String>>,
}

/// The rows of a file, read one after the other.
pub struct CsvSource {
    records: csv::StringRecordsIntoIter<File>,
    options: CsvReadOptions,
    columns: Vec<ImportColumn>,
    /// The line of the record read last, for messages.
    line: u64,
    byte: u64,
}

fn reader(path: &Path, options: &CsvReadOptions) -> Result<csv::Reader<File>> {
    csv::ReaderBuilder::new()
        .delimiter(u8::try_from(options.delimiter).unwrap_or(b','))
        .quote(u8::try_from(options.quote).unwrap_or(b'"'))
        .has_headers(false)
        .flexible(true)
        .from_path(path)
        .map_err(csv_error)
}

fn csv_error(error: csv::Error) -> Error {
    Error::Io(std::io::Error::other(error))
}

/// Opens the file and reads the skipped rows and the row of names; the names of the columns
/// come from there (or `field1`, `field2` …) unless `columns` gives them.
fn open(
    path: &Path,
    options: &CsvReadOptions,
) -> Result<(csv::StringRecordsIntoIter<File>, Vec<String>, u64)> {
    let mut records = reader(path, options)?.into_records();
    let mut line = 0;
    for _ in 0..options.skip_rows {
        if records.next().transpose().map_err(csv_error)?.is_none() {
            break;
        }
        line += 1;
    }
    let mut names = Vec::new();
    if options.header {
        if let Some(record) = records.next().transpose().map_err(csv_error)? {
            line += 1;
            names = record
                .iter()
                .enumerate()
                .map(|(index, name)| {
                    let name = name.trim().trim_start_matches('\u{feff}');
                    if name.is_empty() {
                        format!("field{}", index + 1)
                    } else {
                        name.to_owned()
                    }
                })
                .collect();
        }
    }
    Ok((records, names, line))
}

impl CsvSource {
    pub fn open(
        path: &Path,
        options: CsvReadOptions,
        columns: Option<Vec<ImportColumn>>,
    ) -> Result<Self> {
        let (records, names, line) = open(path, &options)?;
        let columns = columns
            .filter(|columns| !columns.is_empty())
            .unwrap_or_else(|| {
                names
                    .into_iter()
                    .map(|name| ImportColumn {
                        name,
                        kind: ColumnType::Auto,
                        include: true,
                    })
                    .collect()
            });
        Ok(Self {
            records,
            options,
            columns,
            line,
            byte: 0,
        })
    }

    /// Where in the file the record read last starts, in bytes.
    pub fn byte(&self) -> u64 {
        self.byte
    }

    /// Up to `limit` documents; none at the end of the file.
    pub fn next_batch(&mut self, limit: usize) -> Result<Vec<Document>> {
        let mut batch = Vec::new();
        while batch.len() < limit {
            let Some(record) = self.records.next().transpose().map_err(csv_error)? else {
                break;
            };
            self.line = record.position().map_or(self.line + 1, csv::Position::line);
            self.byte = record.position().map_or(self.byte, csv::Position::byte);
            // A line of empty fields is no document.
            if record.iter().all(str::is_empty) {
                continue;
            }
            batch.push(self.document(&record)?);
        }
        Ok(batch)
    }

    fn document(&mut self, record: &csv::StringRecord) -> Result<Document> {
        // Without names: as many `fieldN` columns as the widest row so far.
        while !self.options.header && self.columns.len() < record.len() {
            self.columns.push(ImportColumn {
                name: format!("field{}", self.columns.len() + 1),
                kind: ColumnType::Auto,
                include: true,
            });
        }
        let mut document = Document::new();
        for (index, column) in self.columns.iter().enumerate() {
            if !column.include {
                continue;
            }
            let raw = record.get(index).unwrap_or_default();
            let text = if self.options.unescape {
                unescape(raw)
            } else {
                raw.to_owned()
            };
            let value = if text.is_empty() {
                match self.options.empty {
                    EmptyFields::Null => Bson::Null,
                    EmptyFields::EmptyString => Bson::String(String::new()),
                    EmptyFields::Omit => continue,
                }
            } else {
                convert(&text, column.kind).ok_or_else(|| {
                    Error::ImportText(format!("{}:{} {text}", self.line, index + 1))
                })?
            };
            insert_path(&mut document, &column.name, value);
        }
        Ok(document)
    }
}

/// Reads the head of a file for the schema page.
pub fn preview(path: &Path, options: &CsvReadOptions) -> Result<CsvPreview> {
    let (records, names, _) = open(path, options)?;
    let mut rows: Vec<Vec<String>> = Vec::new();
    for record in records.take(GUESS_ROWS) {
        let record = record.map_err(csv_error)?;
        if record.iter().all(str::is_empty) {
            continue;
        }
        rows.push(
            record
                .iter()
                .map(|text| {
                    if options.unescape {
                        unescape(text)
                    } else {
                        text.to_owned()
                    }
                })
                .collect(),
        );
    }
    let width = rows
        .iter()
        .map(Vec::len)
        .max()
        .unwrap_or(0)
        .max(names.len());
    let columns = (0..width)
        .map(|index| ImportColumn {
            name: names
                .get(index)
                .cloned()
                .unwrap_or_else(|| format!("field{}", index + 1)),
            kind: guess(
                rows.iter()
                    .filter_map(|row| row.get(index))
                    .map(String::as_str),
            ),
            include: true,
        })
        .collect();
    rows.truncate(PREVIEW_ROWS);
    Ok(CsvPreview { columns, rows })
}

/// The type every non-empty field of a column fits, the narrowest first.
fn guess<'a>(fields: impl Iterator<Item = &'a str> + Clone) -> ColumnType {
    let mut values = fields.filter(|text| !text.is_empty()).peekable();
    if values.peek().is_none() {
        return ColumnType::String;
    }
    let fits = |kind| values.clone().all(|text| convert(text, kind).is_some());
    let looks_numeric = values.clone().all(|text| {
        text.chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E'))
    });
    if looks_numeric {
        for kind in [ColumnType::Int, ColumnType::Long, ColumnType::Double] {
            if fits(kind) {
                return kind;
            }
        }
    }
    for kind in [ColumnType::Bool, ColumnType::ObjectId, ColumnType::Date] {
        if fits(kind) {
            return kind;
        }
    }
    ColumnType::String
}

/// A field as a value of the type; `None` when it does not fit.
fn convert(text: &str, kind: ColumnType) -> Option<Bson> {
    let trimmed = text.trim();
    Some(match kind {
        ColumnType::String => Bson::String(text.to_owned()),
        ColumnType::Int => Bson::Int32(trimmed.parse().ok()?),
        ColumnType::Long => Bson::Int64(trimmed.parse().ok()?),
        ColumnType::Double => Bson::Double(trimmed.parse().ok()?),
        ColumnType::Decimal => Bson::Decimal128(Decimal128::from_str(trimmed).ok()?),
        ColumnType::Bool => match trimmed.to_ascii_lowercase().as_str() {
            "true" => Bson::Boolean(true),
            "false" => Bson::Boolean(false),
            _ => return None,
        },
        ColumnType::Date => Bson::DateTime(parse_date(trimmed)?),
        ColumnType::ObjectId => Bson::ObjectId(ObjectId::parse_str(trimmed).ok()?),
        ColumnType::Auto => auto(text),
    })
}

/// A whole number, a decimal number, a boolean, or the text.
fn auto(text: &str) -> Bson {
    if let Ok(number) = text.parse::<i64>() {
        return i32::try_from(number).map_or(Bson::Int64(number), Bson::Int32);
    }
    let looks_numeric = text
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E'));
    if looks_numeric {
        if let Ok(number) = text.parse::<f64>() {
            return Bson::Double(number);
        }
    }
    match text {
        "true" => Bson::Boolean(true),
        "false" => Bson::Boolean(false),
        _ => Bson::String(text.to_owned()),
    }
}

fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('r') => out.push('\r'),
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('0') => out.push('\0'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

/// Sets `a.b.c`, making the sub documents on the way.
fn insert_path(document: &mut Document, path: &str, value: Bson) {
    match path.split_once('.') {
        Some((head, tail)) if !head.is_empty() && !tail.is_empty() => {
            if !matches!(document.get(head), Some(Bson::Document(_))) {
                document.insert(head, Document::new());
            }
            if let Some(Bson::Document(inner)) = document.get_mut(head) {
                insert_path(inner, tail, value);
            }
        }
        _ => {
            document.insert(path, value);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, DateTime};

    fn options() -> CsvReadOptions {
        CsvReadOptions {
            delimiter: ';',
            quote: '\'',
            skip_rows: 1,
            empty: EmptyFields::Null,
            header: true,
            unescape: true,
        }
    }

    fn file(name: &str, text: &str) -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("querymaster-{}-{name}", std::process::id()));
        std::fs::write(&path, text).unwrap();
        path
    }

    #[test]
    fn reads_typed_columns_into_sub_documents() {
        let path = file(
            "typed.csv",
            "exported by a tool\n_id;customer.city;total;at;note;skip\n\
             64b7f0c2a1b2c3d4e5f60718;'Ulm; Donau';7;2024-05-01;a\\nb;x\n\
             \n\
             64b7f0c2a1b2c3d4e5f60719;;8;2024-05-02T10:00:00Z;;y\n",
        );
        let columns = vec![
            ImportColumn {
                name: "_id".into(),
                kind: ColumnType::ObjectId,
                include: true,
            },
            ImportColumn {
                name: "customer.city".into(),
                kind: ColumnType::String,
                include: true,
            },
            ImportColumn {
                name: "total".into(),
                kind: ColumnType::Long,
                include: true,
            },
            ImportColumn {
                name: "at".into(),
                kind: ColumnType::Date,
                include: true,
            },
            ImportColumn {
                name: "note".into(),
                kind: ColumnType::Auto,
                include: true,
            },
            ImportColumn {
                name: "skip".into(),
                kind: ColumnType::Auto,
                include: false,
            },
        ];
        let mut source = CsvSource::open(&path, options(), Some(columns)).unwrap();
        let documents = source.next_batch(1000).unwrap();
        assert_eq!(
            documents,
            [
                doc! {
                    "_id": ObjectId::parse_str("64b7f0c2a1b2c3d4e5f60718").unwrap(),
                    "customer": { "city": "Ulm; Donau" },
                    "total": 7_i64,
                    "at": DateTime::from_millis(1_714_521_600_000),
                    "note": "a\nb",
                },
                doc! {
                    "_id": ObjectId::parse_str("64b7f0c2a1b2c3d4e5f60719").unwrap(),
                    "customer": { "city": null },
                    "total": 8_i64,
                    "at": DateTime::from_millis(1_714_644_000_000),
                    "note": null,
                },
            ]
        );
        assert!(source.next_batch(1000).unwrap().is_empty());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn says_which_field_does_not_fit_its_type() {
        let path = file("bad.csv", "skipped\nn\n1\nzwei\n");
        let columns = vec![ImportColumn {
            name: "n".into(),
            kind: ColumnType::Int,
            include: true,
        }];
        let mut source = CsvSource::open(&path, options(), Some(columns)).unwrap();
        let error = source.next_batch(10).unwrap_err();
        assert!(
            matches!(&error, Error::ImportText(at) if at == "4:1 zwei"),
            "{error:?}"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn previews_names_guessed_types_and_rows() {
        let path = file(
            "preview.csv",
            "a,b,c,d,e\n1,2.5,true,64b7f0c2a1b2c3d4e5f60718,2024-05-01\n3000000000,3,false,,text\n",
        );
        let preview = preview(
            &path,
            &CsvReadOptions {
                delimiter: ',',
                quote: '"',
                skip_rows: 0,
                empty: EmptyFields::Omit,
                header: true,
                unescape: false,
            },
        )
        .unwrap();
        let kinds: Vec<_> = preview.columns.iter().map(|column| column.kind).collect();
        assert_eq!(
            kinds,
            [
                ColumnType::Long,
                ColumnType::Double,
                ColumnType::Bool,
                ColumnType::ObjectId,
                ColumnType::String
            ]
        );
        assert_eq!(preview.rows.len(), 2);
        assert_eq!(preview.rows[1][0], "3000000000");

        // Without names, and empty fields left out.
        std::fs::write(&path, "1,x\n2\n").unwrap();
        let mut source = CsvSource::open(
            &path,
            CsvReadOptions {
                delimiter: ',',
                quote: '"',
                skip_rows: 0,
                empty: EmptyFields::Omit,
                header: false,
                unescape: false,
            },
            None,
        )
        .unwrap();
        assert_eq!(
            source.next_batch(10).unwrap(),
            [doc! { "field1": 1, "field2": "x" }, doc! { "field1": 2 }]
        );
        std::fs::remove_file(path).unwrap();
    }
}
