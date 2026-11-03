//! JSON as the export writes it: each document over several lines, indented with
//! tabs, keys in quotes, lines ending in CRLF. Values in one of three notations: the shell's
//! (`ObjectId("…")`, `ISODate("…")` – what "Mongo Shell" gives), relaxed Extended JSON (what
//! `mongoexport` gives) or canonical Extended JSON (every type kept exactly).

use base64::Engine as _;
use mongodb::bson::{spec::BinarySubtype, Bson, Document};
use serde::Deserialize;

pub const LINE: &str = "\r\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Notation {
    Shell,
    Relaxed,
    Canonical,
}

/// How the documents of a file follow each other.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Layout {
    /// One after the other, nothing between ("Default").
    Lines,
    /// A comma between them.
    Comma,
    /// All in one array.
    Array,
}

/// Writes the documents of one file, document after document.
pub struct JsonWriter {
    notation: Notation,
    layout: Layout,
    first: bool,
}

impl JsonWriter {
    pub fn new(notation: Notation, layout: Layout) -> Self {
        Self {
            notation,
            layout,
            first: true,
        }
    }

    /// The text before the first document.
    pub fn start(&self) -> &'static str {
        if self.layout == Layout::Array {
            "[\r\n"
        } else {
            ""
        }
    }

    pub fn document(&mut self, document: &Document) -> String {
        let mut text = String::new();
        if !self.first && self.layout != Layout::Lines {
            // The comma goes after the closing brace of the one before.
            text.push(',');
        }
        if !self.first {
            text.push_str(LINE);
        }
        self.first = false;
        // Extended JSON one after the other is what `mongoexport` writes:
        // one document per line (JSON Lines), so line-based tools read it.
        if self.notation != Notation::Shell && self.layout == Layout::Lines {
            let json = match self.notation {
                Notation::Canonical => Bson::Document(document.clone()).into_canonical_extjson(),
                _ => Bson::Document(document.clone()).into_relaxed_extjson(),
            };
            text.push_str(&serde_json::to_string(&json).unwrap_or_default());
            return text;
        }
        let indent = if self.layout == Layout::Array {
            "\t"
        } else {
            ""
        };
        if self.layout == Layout::Array {
            text.push('\t');
        }
        write_value(
            &mut text,
            &Bson::Document(document.clone()),
            indent,
            self.notation,
        );
        text
    }

    /// The text after the last document.
    pub fn finish(&self) -> &'static str {
        match (self.layout, self.first) {
            (Layout::Array, true) => "]\r\n",
            (Layout::Array, false) => "\r\n]\r\n",
            (_, true) => "",
            (_, false) => LINE,
        }
    }
}

fn quoted(text: &str) -> String {
    serde_json::to_string(text).unwrap_or_else(|_| format!("\"{text}\""))
}

fn write_value(out: &mut String, value: &Bson, indent: &str, notation: Notation) {
    match value {
        Bson::Document(document) => {
            if document.is_empty() {
                out.push_str("{}");
                return;
            }
            let inner = format!("{indent}\t");
            out.push('{');
            for (position, (key, item)) in document.iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                out.push_str(LINE);
                out.push_str(&inner);
                out.push_str(&quoted(key));
                out.push_str(": ");
                write_value(out, item, &inner, notation);
            }
            out.push_str(LINE);
            out.push_str(indent);
            out.push('}');
        }
        Bson::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            let inner = format!("{indent}\t");
            out.push('[');
            for (position, item) in items.iter().enumerate() {
                if position > 0 {
                    out.push(',');
                }
                out.push_str(LINE);
                out.push_str(&inner);
                write_value(out, item, &inner, notation);
            }
            out.push_str(LINE);
            out.push_str(indent);
            out.push(']');
        }
        scalar => out.push_str(&scalar_text(scalar, notation)),
    }
}

fn scalar_text(value: &Bson, notation: Notation) -> String {
    match notation {
        Notation::Shell => shell_scalar(value),
        Notation::Relaxed => value.clone().into_relaxed_extjson().to_string(),
        Notation::Canonical => value.clone().into_canonical_extjson().to_string(),
    }
}

/// A date as the export writes it: always with milliseconds and `+00:00`.
fn iso_date(millis: i64) -> Option<String> {
    let date = chrono::DateTime::<chrono::Utc>::from_timestamp_millis(millis)?;
    Some(date.format("%Y-%m-%dT%H:%M:%S%.3f+00:00").to_string())
}

fn shell_double(number: f64) -> String {
    if number.is_nan() {
        "NaN".into()
    } else if number.is_infinite() {
        if number > 0.0 {
            "Infinity"
        } else {
            "-Infinity"
        }
        .into()
    } else if number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{number:.1}")
    } else {
        number.to_string()
    }
}

fn uuid_text(bytes: &[u8]) -> String {
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

/// One value in the shell's notation, as the export writes it (`toShell` in
/// `src/shell/ejson.ts` shows an int32 bare, as mongosh does).
fn shell_scalar(value: &Bson) -> String {
    match value {
        Bson::String(text) => quoted(text),
        // The type stays, so the shell reads it back as it was.
        Bson::Symbol(text) => format!("Symbol({})", quoted(text)),
        Bson::Int32(number) => format!("NumberInt({number})"),
        Bson::Int64(number) => format!("NumberLong({number})"),
        Bson::Double(number) => shell_double(*number),
        Bson::Decimal128(number) => format!("NumberDecimal(\"{number}\")"),
        Bson::Boolean(flag) => flag.to_string(),
        Bson::Null => "null".into(),
        Bson::Undefined => "undefined".into(),
        Bson::ObjectId(id) => format!("ObjectId(\"{}\")", id.to_hex()),
        Bson::DateTime(date) => match iso_date(date.timestamp_millis()) {
            Some(text) => format!("ISODate(\"{text}\")"),
            None => format!("new Date({})", date.timestamp_millis()),
        },
        Bson::RegularExpression(regex) => format!("/{}/{}", regex.pattern, regex.options),
        Bson::Binary(binary)
            if binary.subtype == BinarySubtype::Uuid && binary.bytes.len() == 16 =>
        {
            format!("UUID(\"{}\")", uuid_text(&binary.bytes))
        }
        Bson::Binary(binary) => format!(
            "BinData({}, \"{}\")",
            u8::from(binary.subtype),
            base64::engine::general_purpose::STANDARD.encode(&binary.bytes)
        ),
        Bson::Timestamp(stamp) => format!("Timestamp({}, {})", stamp.time, stamp.increment),
        Bson::MinKey => "MinKey()".into(),
        Bson::MaxKey => "MaxKey()".into(),
        Bson::JavaScriptCode(code) => format!("Code({})", quoted(code)),
        other => other.clone().into_relaxed_extjson().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId, Binary, DateTime, Decimal128, Timestamp};

    fn sample() -> Document {
        doc! {
            "_id": ObjectId::parse_str("6a9560f4e9437e14386018c9").unwrap(),
            "Key": "Jira",
            "Comment": null,
            "DateStarted": DateTime::from_millis(1_784_705_160_000),
            "Attributes": { "siteUrl": "https://example.net", "count": 3 },
            "Sources": [{ "Kind": "Planning", "Confidence": 0.72 }],
            "Empty": []
        }
    }

    /// The form of the "Mongo Shell" export (BOM aside, which the file gets).
    #[test]
    fn writes_the_shell_notation() {
        let mut writer = JsonWriter::new(Notation::Shell, Layout::Lines);
        let mut text = writer.start().to_owned();
        text += &writer.document(&sample());
        text += &writer.document(&doc! { "_id": 2 });
        text += writer.finish();
        let expected = [
            "{",
            "\t\"_id\": ObjectId(\"6a9560f4e9437e14386018c9\"),",
            "\t\"Key\": \"Jira\",",
            "\t\"Comment\": null,",
            "\t\"DateStarted\": ISODate(\"2026-07-22T07:26:00.000+00:00\"),",
            "\t\"Attributes\": {",
            "\t\t\"siteUrl\": \"https://example.net\",",
            "\t\t\"count\": NumberInt(3)",
            "\t},",
            "\t\"Sources\": [",
            "\t\t{",
            "\t\t\t\"Kind\": \"Planning\",",
            "\t\t\t\"Confidence\": 0.72",
            "\t\t}",
            "\t],",
            "\t\"Empty\": []",
            "}",
            "{",
            "\t\"_id\": NumberInt(2)",
            "}",
            "",
        ]
        .join("\r\n");
        assert_eq!(text, expected);
    }

    #[test]
    fn writes_every_type_as_the_shell_does() {
        let value = |bson: Bson| shell_scalar(&bson);
        assert_eq!(value(Bson::Int64(5)), "NumberLong(5)");
        assert_eq!(value(Bson::Double(5.0)), "5.0");
        assert_eq!(
            value(Bson::Decimal128("9.99".parse::<Decimal128>().unwrap())),
            "NumberDecimal(\"9.99\")"
        );
        assert_eq!(
            value(Bson::Binary(Binary {
                subtype: BinarySubtype::Generic,
                bytes: b"abc".to_vec()
            })),
            "BinData(0, \"YWJj\")"
        );
        assert_eq!(
            value(Bson::Binary(Binary {
                subtype: BinarySubtype::Uuid,
                bytes: (0..16).collect()
            })),
            "UUID(\"00010203-0405-0607-0809-0a0b0c0d0e0f\")"
        );
        assert_eq!(
            value(Bson::Timestamp(Timestamp {
                time: 7,
                increment: 1
            })),
            "Timestamp(7, 1)"
        );
        assert_eq!(value(Bson::String("a\"b".into())), "\"a\\\"b\"");
    }

    #[test]
    fn separates_with_commas_or_wraps_in_an_array() {
        let documents = [doc! { "a": 1 }, doc! { "a": 2 }];
        let write = |layout| {
            let mut writer = JsonWriter::new(Notation::Relaxed, layout);
            let mut text = writer.start().to_owned();
            for document in &documents {
                text += &writer.document(document);
            }
            text + writer.finish()
        };
        assert_eq!(
            write(Layout::Comma),
            "{\r\n\t\"a\": 1\r\n},\r\n{\r\n\t\"a\": 2\r\n}\r\n"
        );
        assert_eq!(
            write(Layout::Array),
            "[\r\n\t{\r\n\t\t\"a\": 1\r\n\t},\r\n\t{\r\n\t\t\"a\": 2\r\n\t}\r\n]\r\n"
        );
        let empty = JsonWriter::new(Notation::Relaxed, Layout::Array);
        assert_eq!(format!("{}{}", empty.start(), empty.finish()), "[\r\n]\r\n");
    }

    #[test]
    fn keeps_types_in_canonical_and_simplifies_in_relaxed() {
        let mut canonical = JsonWriter::new(Notation::Canonical, Layout::Array);
        assert!(canonical
            .document(&doc! { "n": 5_i64 })
            .contains("\"n\": {\"$numberLong\":\"5\"}"));
        let mut relaxed = JsonWriter::new(Notation::Relaxed, Layout::Array);
        assert!(relaxed.document(&doc! { "n": 5_i64 }).contains("\"n\": 5"));
    }

    #[test]
    fn writes_extended_json_one_document_per_line_as_mongoexport() {
        let mut relaxed = JsonWriter::new(Notation::Relaxed, Layout::Lines);
        let first = relaxed.document(&doc! { "_id": 1, "sub": { "a": [1, 2] } });
        let second = relaxed.document(&doc! { "_id": 2 });
        assert_eq!(first, r#"{"_id":1,"sub":{"a":[1,2]}}"#);
        assert_eq!(second, "\r\n{\"_id\":2}");
        assert_eq!(relaxed.finish(), LINE);
        let mut canonical = JsonWriter::new(Notation::Canonical, Layout::Lines);
        assert_eq!(
            canonical.document(&doc! { "n": 5_i64 }),
            r#"{"n":{"$numberLong":"5"}}"#
        );
    }
}
