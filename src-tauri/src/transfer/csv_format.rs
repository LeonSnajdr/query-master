//! CSV: a column per field of the first level. The columns are those of the first batch, in the
//! order the fields first appear; a field seen only later is reported, not written. Nested values
//! are written as relaxed extended JSON. Reading guesses numbers and booleans, the rest stays text.

use std::collections::BTreeSet;
use std::fs::File;
use std::io::BufWriter;
use std::path::Path;

use mongodb::bson::{Bson, Document};

use crate::error::{Error, Result};

pub struct CsvWriter {
    writer: csv::Writer<BufWriter<File>>,
    columns: Option<Vec<String>>,
    skipped: BTreeSet<String>,
}

impl CsvWriter {
    pub fn new(file: BufWriter<File>) -> Self {
        Self {
            writer: csv::Writer::from_writer(file),
            columns: None,
            skipped: BTreeSet::new(),
        }
    }

    pub fn write(&mut self, documents: &[Document]) -> Result<()> {
        if self.columns.is_none() {
            let columns = columns_of(documents);
            self.writer.write_record(&columns).map_err(csv_error)?;
            self.columns = Some(columns);
        }
        let columns = self.columns.as_ref().expect("set above");
        for document in documents {
            for key in document.keys() {
                if !columns.contains(key) {
                    self.skipped.insert(key.clone());
                }
            }
            let record = columns
                .iter()
                .map(|column| document.get(column).map(cell).unwrap_or_default());
            self.writer.write_record(record).map_err(csv_error)?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<Vec<String>> {
        self.writer.flush()?;
        Ok(self.skipped.into_iter().collect())
    }
}

fn csv_error(error: csv::Error) -> Error {
    Error::Io(std::io::Error::other(error))
}

/// The fields of the first level, in the order they first appear.
fn columns_of(documents: &[Document]) -> Vec<String> {
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

/// A value as the text of a cell: plain for scalars, JSON for the rest.
fn cell(value: &Bson) -> String {
    match value {
        Bson::String(text) => text.clone(),
        Bson::Int32(number) => number.to_string(),
        Bson::Int64(number) => number.to_string(),
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

/// The value a cell stands for: a whole number, a decimal number, a boolean, or text. An empty
/// cell leaves the field out.
fn value_of(text: &str) -> Option<Bson> {
    if text.is_empty() {
        return None;
    }
    if let Ok(number) = text.parse::<i64>() {
        return Some(i32::try_from(number).map_or(Bson::Int64(number), Bson::Int32));
    }
    let looks_numeric = text
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E'));
    if looks_numeric {
        if let Ok(number) = text.parse::<f64>() {
            return Some(Bson::Double(number));
        }
    }
    Some(match text {
        "true" => Bson::Boolean(true),
        "false" => Bson::Boolean(false),
        _ => Bson::String(text.to_owned()),
    })
}

pub fn read(path: &Path) -> Result<Vec<Document>> {
    let mut reader = csv::Reader::from_path(path).map_err(csv_error)?;
    let headers = reader.headers().map_err(csv_error)?.clone();
    let mut documents = Vec::new();
    for record in reader.records() {
        let record = record.map_err(csv_error)?;
        let mut document = Document::new();
        for (header, text) in headers.iter().zip(record.iter()) {
            if let Some(value) = value_of(text) {
                document.insert(header, value);
            }
        }
        documents.push(document);
    }
    Ok(documents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId, DateTime};

    #[test]
    fn writes_cells_and_quotes_what_needs_it() {
        let path =
            std::env::temp_dir().join(format!("querymaster-{}-cells.csv", std::process::id()));
        let id = ObjectId::parse_str("64b7f0c2a1b2c3d4e5f60718").unwrap();
        let mut writer = CsvWriter::new(BufWriter::new(File::create(&path).unwrap()));
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
            "_id,name,at,tags\n64b7f0c2a1b2c3d4e5f60718,\"Anna, \"\"A\"\"\",1970-01-01T00:00:00Z,\n2,\"line\nbreak\",,\"[\"\"a\"\",1]\"\n3,,,\n"
        );
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn reads_numbers_booleans_and_text_back() {
        let path =
            std::env::temp_dir().join(format!("querymaster-{}-read.csv", std::process::id()));
        std::fs::write(&path, "a,b,c,d,e,f\n1,2.5,true,,9007199254740993,1e3x\n").unwrap();
        assert_eq!(
            read(&path).unwrap(),
            [doc! { "a": 1, "b": 2.5, "c": true, "e": 9_007_199_254_740_993_i64, "f": "1e3x" }]
        );
        std::fs::remove_file(path).unwrap();
    }
}
