//! Reads the documents of a JSON file in any of the notations the export writes: the shell's
//! (`ObjectId("…")`, `ISODate("…")`, `NumberLong(…)`, keys without quotes, single quotes,
//! comments), relaxed and canonical Extended JSON (`{"$oid": …}`), mixed as they come. The
//! documents may follow each other directly, with commas between them, or stand in one array.
//! They are handed out one at a time, so a large file is inserted batch by batch.

use std::str::FromStr;

use base64::Engine as _;
use mongodb::bson::{
    oid::ObjectId, spec::BinarySubtype, Binary, Bson, DateTime, Decimal128, Document, Regex,
    Timestamp,
};

use crate::error::{Error, Result};

/// Keys that make a document a value of Extended JSON.
const WRAPPERS: [&str; 17] = [
    "$oid",
    "$date",
    "$numberLong",
    "$numberInt",
    "$numberDouble",
    "$numberDecimal",
    "$binary",
    "$uuid",
    "$timestamp",
    "$regularExpression",
    "$regex",
    "$minKey",
    "$maxKey",
    "$undefined",
    "$symbol",
    "$code",
    "$dbPointer",
];

pub struct ShellReader<'a> {
    text: &'a str,
    pos: usize,
    started: bool,
    in_array: bool,
}

/// Where a reader stopped, to go on from there with a new one over the same text.
#[derive(Debug, Clone, Copy, Default)]
pub struct ReadPosition {
    pos: usize,
    started: bool,
    in_array: bool,
}

impl ReadPosition {
    /// The bytes read so far (after a byte order mark).
    pub fn bytes(&self) -> usize {
        self.pos
    }
}

impl<'a> ShellReader<'a> {
    #[cfg(test)]
    pub fn new(text: &'a str) -> Self {
        Self::resume(text, ReadPosition::default())
    }

    pub fn resume(text: &'a str, at: ReadPosition) -> Self {
        Self {
            text: text.strip_prefix('\u{feff}').unwrap_or(text),
            pos: at.pos,
            started: at.started,
            in_array: at.in_array,
        }
    }

    pub fn position(&self) -> ReadPosition {
        ReadPosition {
            pos: self.pos,
            started: self.started,
            in_array: self.in_array,
        }
    }

    /// The next document; `None` at the end of the text.
    pub fn next_document(&mut self) -> Result<Option<Document>> {
        if !self.started {
            self.started = true;
            self.skip_space()?;
            if self.peek() == Some('[') {
                self.pos += 1;
                self.in_array = true;
            }
        }
        loop {
            self.skip_space()?;
            match self.peek() {
                Some(',') => self.pos += 1,
                Some(']') if self.in_array => {
                    self.pos += 1;
                    self.skip_space()?;
                    if self.peek().is_some() {
                        return Err(self.error());
                    }
                    self.in_array = false;
                    return Ok(None);
                }
                None if self.in_array => return Err(self.error()),
                None => return Ok(None),
                Some(_) => break,
            }
        }
        let start = self.pos;
        match self.value()? {
            Bson::Document(document) => Ok(Some(document)),
            _ => {
                self.pos = start;
                Err(Error::ImportShape)
            }
        }
    }

    /// Where the reading stopped, as `line:column` and a piece of the text there.
    fn error(&self) -> Error {
        let before = &self.text[..self.pos];
        let line = before.matches('\n').count() + 1;
        let column = before
            .rsplit('\n')
            .next()
            .map_or(0, |part| part.chars().count())
            + 1;
        let excerpt: String = self.text[self.pos..]
            .chars()
            .take(30)
            .take_while(|c| *c != '\n' && *c != '\r')
            .collect();
        Error::ImportText(format!("{line}:{column} {excerpt}"))
    }

    fn peek(&self) -> Option<char> {
        self.text[self.pos..].chars().next()
    }

    fn rest(&self) -> &'a str {
        let text: &'a str = self.text;
        &text[self.pos..]
    }

    fn bump(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.pos += c.len_utf8();
        Some(c)
    }

    fn expect(&mut self, wanted: char) -> Result<()> {
        self.skip_space()?;
        if self.peek() == Some(wanted) {
            self.pos += 1;
            Ok(())
        } else {
            Err(self.error())
        }
    }

    /// Whitespace and comments (`// …`, `/* … */`).
    fn skip_space(&mut self) -> Result<()> {
        loop {
            let rest = self.rest();
            let trimmed = rest.trim_start();
            self.pos += rest.len() - trimmed.len();
            if trimmed.starts_with("//") {
                self.pos += trimmed.find('\n').unwrap_or(trimmed.len());
            } else if let Some(comment) = trimmed.strip_prefix("/*") {
                match comment.find("*/") {
                    Some(end) => self.pos += end + 4,
                    None => return Err(self.error()),
                }
            } else {
                return Ok(());
            }
        }
    }

    fn value(&mut self) -> Result<Bson> {
        self.skip_space()?;
        match self.peek() {
            Some('{') => self.object(),
            Some('[') => self.array(),
            Some('"' | '\'') => Ok(Bson::String(self.string()?)),
            Some('/') => self.regex(),
            Some(c) if c.is_ascii_digit() || matches!(c, '-' | '+' | '.') => self.number(),
            Some(c) if c.is_alphabetic() || c == '_' || c == '$' => self.word_value(),
            _ => Err(self.error()),
        }
    }

    fn object(&mut self) -> Result<Bson> {
        self.pos += 1;
        let mut document = Document::new();
        loop {
            self.skip_space()?;
            match self.peek() {
                Some('}') => {
                    self.pos += 1;
                    break;
                }
                Some(',') if !document.is_empty() => {
                    self.pos += 1;
                    continue;
                }
                _ => {}
            }
            let key = match self.peek() {
                Some('"' | '\'') => self.string()?,
                _ => {
                    let word = self.word();
                    if word.is_empty() {
                        return Err(self.error());
                    }
                    word.to_owned()
                }
            };
            self.expect(':')?;
            let value = self.value()?;
            document.insert(key, value);
            self.skip_space()?;
            match self.peek() {
                Some(',') => self.pos += 1,
                Some('}') => {}
                _ => return Err(self.error()),
            }
        }
        let wrapper = document
            .keys()
            .next()
            .is_some_and(|key| WRAPPERS.contains(&key.as_str()));
        if wrapper {
            // Extended JSON: the children are read already, so they are passed on in a form the
            // wrapper takes – relaxed for `$timestamp` (plain numbers), canonical for `$date`.
            let wrapped = Bson::Document(document.clone());
            for json in [
                wrapped.clone().into_relaxed_extjson(),
                wrapped.into_canonical_extjson(),
            ] {
                if let Ok(value) = Bson::try_from(json) {
                    return Ok(value);
                }
            }
        }
        Ok(Bson::Document(document))
    }

    fn array(&mut self) -> Result<Bson> {
        self.pos += 1;
        let mut items = Vec::new();
        loop {
            self.skip_space()?;
            match self.peek() {
                Some(']') => {
                    self.pos += 1;
                    return Ok(Bson::Array(items));
                }
                Some(',') if !items.is_empty() => {
                    self.pos += 1;
                    continue;
                }
                _ => {}
            }
            items.push(self.value()?);
            self.skip_space()?;
            match self.peek() {
                Some(',') => self.pos += 1,
                Some(']') => {}
                _ => return Err(self.error()),
            }
        }
    }

    fn string(&mut self) -> Result<String> {
        let start = self.pos;
        let quote = self.bump().ok_or_else(|| self.error())?;
        let mut out = String::new();
        loop {
            let Some(c) = self.bump() else {
                self.pos = start;
                return Err(self.error());
            };
            match c {
                c if c == quote => return Ok(out),
                '\\' => {
                    let escaped = self.bump().ok_or_else(|| self.error())?;
                    match escaped {
                        'n' => out.push('\n'),
                        'r' => out.push('\r'),
                        't' => out.push('\t'),
                        'b' => out.push('\u{8}'),
                        'f' => out.push('\u{c}'),
                        '0' => out.push('\0'),
                        'u' => out.push(self.unicode_escape()?),
                        // A line break after a backslash continues the string.
                        '\r' => {
                            if self.peek() == Some('\n') {
                                self.pos += 1;
                            }
                        }
                        '\n' => {}
                        other => out.push(other),
                    }
                }
                c => out.push(c),
            }
        }
    }

    fn hex4(&mut self) -> Result<u32> {
        let digits = self.rest().get(..4).ok_or_else(|| self.error())?;
        let code = u32::from_str_radix(digits, 16).map_err(|_| self.error())?;
        self.pos += 4;
        Ok(code)
    }

    fn unicode_escape(&mut self) -> Result<char> {
        let high = self.hex4()?;
        if (0xD800..0xDC00).contains(&high) && self.rest().starts_with("\\u") {
            let back = self.pos;
            self.pos += 2;
            let low = self.hex4()?;
            if (0xDC00..0xE000).contains(&low) {
                let code = 0x10000 + ((high - 0xD800) << 10) + (low - 0xDC00);
                return char::from_u32(code).ok_or_else(|| self.error());
            }
            self.pos = back;
        }
        Ok(char::from_u32(high).unwrap_or('\u{fffd}'))
    }

    /// `/pattern/flags`.
    fn regex(&mut self) -> Result<Bson> {
        let start = self.pos;
        self.pos += 1;
        let mut pattern = String::new();
        let mut in_class = false;
        loop {
            let Some(c) = self.bump() else {
                self.pos = start;
                return Err(self.error());
            };
            match c {
                '\\' => {
                    pattern.push(c);
                    if let Some(next) = self.bump() {
                        pattern.push(next);
                    }
                }
                '[' => {
                    in_class = true;
                    pattern.push(c);
                }
                ']' => {
                    in_class = false;
                    pattern.push(c);
                }
                '/' if !in_class => break,
                '\n' => {
                    self.pos = start;
                    return Err(self.error());
                }
                c => pattern.push(c),
            }
        }
        let flags = self.word();
        Ok(regex(&pattern, flags))
    }

    fn number(&mut self) -> Result<Bson> {
        let start = self.pos;
        let rest = self.rest();
        for (sign, value) in [
            ("-Infinity", f64::NEG_INFINITY),
            ("+Infinity", f64::INFINITY),
        ] {
            if rest.starts_with(sign) {
                self.pos += sign.len();
                return Ok(Bson::Double(value));
            }
        }
        let length = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || matches!(c, '-' | '+' | '.')))
            .unwrap_or(rest.len());
        let text = &rest[..length];
        self.pos += length;
        let integral = !text.contains(['.', 'e', 'E']) && !text.starts_with("0x");
        if integral {
            if let Ok(number) = text.parse::<i64>() {
                return Ok(i32::try_from(number).map_or(Bson::Int64(number), Bson::Int32));
            }
        }
        if let Ok(number) = text.trim_start_matches('+').parse::<f64>() {
            return Ok(Bson::Double(number));
        }
        self.pos = start;
        Err(self.error())
    }

    fn word(&mut self) -> &'a str {
        let text: &'a str = self.text;
        let rest = &text[self.pos..];
        let length = rest
            .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
            .unwrap_or(rest.len());
        self.pos += length;
        &rest[..length]
    }

    /// A name: a literal, or a constructor as `ObjectId("…")` (also after `new`).
    fn word_value(&mut self) -> Result<Bson> {
        let start = self.pos;
        let mut word = self.word();
        if word == "new" {
            self.skip_space()?;
            word = self.word();
        }
        self.skip_space()?;
        let arguments = if self.peek() == Some('(') {
            self.pos += 1;
            let mut arguments = Vec::new();
            loop {
                self.skip_space()?;
                if self.peek() == Some(')') {
                    self.pos += 1;
                    break;
                }
                arguments.push(self.value()?);
                self.skip_space()?;
                match self.peek() {
                    Some(',') => self.pos += 1,
                    Some(')') => {}
                    _ => return Err(self.error()),
                }
            }
            Some(arguments)
        } else {
            None
        };
        let value = match (word, arguments) {
            ("true", None) => Some(Bson::Boolean(true)),
            ("false", None) => Some(Bson::Boolean(false)),
            ("null", None) => Some(Bson::Null),
            ("undefined", None) => Some(Bson::Undefined),
            ("NaN", None) => Some(Bson::Double(f64::NAN)),
            ("Infinity", None) => Some(Bson::Double(f64::INFINITY)),
            ("MinKey", _) => Some(Bson::MinKey),
            ("MaxKey", _) => Some(Bson::MaxKey),
            (name, Some(arguments)) => construct(name, &arguments),
            _ => None,
        };
        value.ok_or_else(|| {
            self.pos = start;
            self.error()
        })
    }
}

fn text_of(value: Option<&Bson>) -> Option<&str> {
    match value {
        Some(Bson::String(text)) => Some(text),
        _ => None,
    }
}

fn integer_of(value: Option<&Bson>) -> Option<i64> {
    match value? {
        Bson::Int32(number) => Some(i64::from(*number)),
        Bson::Int64(number) => Some(*number),
        Bson::Double(number) if number.fract() == 0.0 => Some(*number as i64),
        Bson::String(text) => text.trim().parse().ok(),
        _ => None,
    }
}

/// A date as the shell takes it: full ISO 8601, or only the date, or without a zone (then UTC).
pub(super) fn parse_date(text: &str) -> Option<DateTime> {
    let text = text.trim();
    if let Ok(date) = chrono::DateTime::parse_from_rfc3339(text) {
        return Some(DateTime::from_millis(date.timestamp_millis()));
    }
    for format in [
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%dT%H:%M",
    ] {
        if let Ok(date) = chrono::NaiveDateTime::parse_from_str(text, format) {
            return Some(DateTime::from_millis(date.and_utc().timestamp_millis()));
        }
    }
    let date = chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d").ok()?;
    Some(DateTime::from_millis(
        date.and_hms_opt(0, 0, 0)?.and_utc().timestamp_millis(),
    ))
}

fn construct(name: &str, arguments: &[Bson]) -> Option<Bson> {
    let first = arguments.first();
    Some(match name {
        "ObjectId" => match text_of(first) {
            Some(hex) => Bson::ObjectId(ObjectId::parse_str(hex).ok()?),
            None if arguments.is_empty() => Bson::ObjectId(ObjectId::new()),
            None => return None,
        },
        "ISODate" | "Date" => match first {
            None => Bson::DateTime(DateTime::now()),
            Some(Bson::String(text)) => Bson::DateTime(parse_date(text)?),
            Some(_) => Bson::DateTime(DateTime::from_millis(integer_of(first)?)),
        },
        "NumberLong" => Bson::Int64(integer_of(first)?),
        "NumberInt" => Bson::Int32(i32::try_from(integer_of(first)?).ok()?),
        "NumberDecimal" | "Decimal128" => {
            let text = match first? {
                Bson::String(text) => text.clone(),
                Bson::Int32(number) => number.to_string(),
                Bson::Int64(number) => number.to_string(),
                Bson::Double(number) => number.to_string(),
                _ => return None,
            };
            Bson::Decimal128(Decimal128::from_str(&text).ok()?)
        }
        "BinData" => {
            let subtype = u8::try_from(integer_of(first)?).ok()?;
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(text_of(arguments.get(1))?)
                .ok()?;
            Bson::Binary(Binary {
                subtype: BinarySubtype::from(subtype),
                bytes,
            })
        }
        "UUID" => {
            let hex: String = text_of(first)?.chars().filter(|c| *c != '-').collect();
            if hex.len() != 32 {
                return None;
            }
            let bytes = (0..16)
                .map(|index| u8::from_str_radix(&hex[index * 2..index * 2 + 2], 16).ok())
                .collect::<Option<Vec<u8>>>()?;
            Bson::Binary(Binary {
                subtype: BinarySubtype::Uuid,
                bytes,
            })
        }
        "Timestamp" => {
            let (time, increment) = match first? {
                Bson::Document(parts) => (integer_of(parts.get("t"))?, integer_of(parts.get("i"))?),
                _ => (integer_of(first)?, integer_of(arguments.get(1))?),
            };
            Bson::Timestamp(Timestamp {
                time: u32::try_from(time).ok()?,
                increment: u32::try_from(increment).ok()?,
            })
        }
        "Code" => Bson::JavaScriptCode(text_of(first)?.to_owned()),
        // What the export writes besides the shell's own helpers.
        "Symbol" => Bson::Symbol(text_of(first)?.to_owned()),
        "LUUID" => Bson::Binary(Binary {
            subtype: BinarySubtype::UuidOld,
            bytes: hex_bytes(text_of(first)?, 16)?,
        }),
        "MD5" => Bson::Binary(Binary {
            subtype: BinarySubtype::Md5,
            bytes: hex_bytes(text_of(first)?, 16)?,
        }),
        "RegExp" => regex(
            text_of(first)?,
            text_of(arguments.get(1)).unwrap_or_default(),
        ),
        _ => return None,
    })
}

/// Bytes from hex digits (dashes left out), exactly `length` of them.
fn hex_bytes(text: &str, length: usize) -> Option<Vec<u8>> {
    let hex: String = text.chars().filter(|c| *c != '-').collect();
    if hex.len() != length * 2 {
        return None;
    }
    (0..length)
        .map(|index| u8::from_str_radix(hex.get(index * 2..index * 2 + 2)?, 16).ok())
        .collect()
}

/// A regular expression with its options in alphabetical order, as BSON keeps them.
fn regex(pattern: &str, options: &str) -> Bson {
    let mut options: Vec<char> = options.chars().collect();
    options.sort_unstable();
    Bson::RegularExpression(Regex {
        pattern: pattern.to_owned(),
        options: options.into_iter().collect(),
    })
}

/// Every document of a text; for the tests and small texts.
#[cfg(test)]
pub fn read_all(text: &str) -> Result<Vec<Document>> {
    let mut reader = ShellReader::new(text);
    let mut documents = Vec::new();
    while let Some(document) = reader.next_document()? {
        documents.push(document);
    }
    Ok(documents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transfer::json_format::{JsonWriter, Layout, Notation};
    use mongodb::bson::doc;

    fn every_type() -> Document {
        doc! {
            "_id": ObjectId::parse_str("6a9560f4e9437e14386018c9").unwrap(),
            "text": "quote \" and \\ and\nbreak, ünïcode 😀",
            "int": 3,
            "long": 9_007_199_254_740_993_i64,
            "small long": 5_i64,
            "double": 5.0,
            "fraction": 0.72,
            "decimal": Decimal128::from_str("9.99").unwrap(),
            "flag": true,
            "nothing": null,
            "at": DateTime::from_millis(1_784_705_160_123),
            "regex": regex("^a[/]b", "i"),
            "bin": Binary { subtype: BinarySubtype::Generic, bytes: b"abc".to_vec() },
            "uuid": Binary { subtype: BinarySubtype::Uuid, bytes: (0..16).collect() },
            "stamp": Timestamp { time: 7, increment: 1 },
            "min": Bson::MinKey,
            "max": Bson::MaxKey,
            "sym": Bson::Symbol("s".into()),
            "nested": { "list": [1, "two", { "deep": [] }], "empty": {} },
        }
    }

    #[test]
    fn reads_back_what_the_export_writes_in_every_notation_and_layout() {
        let documents = [every_type(), doc! { "_id": 2 }];
        for notation in [Notation::Shell, Notation::Relaxed, Notation::Canonical] {
            for layout in [Layout::Lines, Layout::Comma, Layout::Array] {
                let mut writer = JsonWriter::new(notation, layout);
                let mut text = format!("\u{feff}{}", writer.start());
                for document in &documents {
                    text += &writer.document(document);
                }
                text += writer.finish();
                let read = read_all(&text)
                    .unwrap_or_else(|error| panic!("{notation:?} {layout:?}: {error:?}\n{text}"));
                // Relaxed JSON can not tell a whole double from an int, nor a small long.
                if notation == Notation::Relaxed {
                    assert_eq!(read.len(), 2);
                    assert_eq!(read[0].get("at"), documents[0].get("at"));
                    assert_eq!(read[0].get("uuid"), documents[0].get("uuid"));
                } else {
                    assert_eq!(read, documents, "{notation:?} {layout:?}");
                }
            }
        }
    }

    #[test]
    fn reads_what_people_type_in_the_shell() {
        let text = r#"
            // a comment
            { name: 'it\'s', n: NumberInt("4"), at: new Date(0), day: ISODate("2024-05-01"),
              id: ObjectId('64b7f0c2a1b2c3d4e5f60718'), stamp: Timestamp({ t: 1, i: 2 }),
              list: [1, 2,], neg: -1.5e3, /* inline */ big: 3000000000 }
            {"x": {"$numberLong": "7"}, "d": {"$date": "1970-01-01T00:00:00Z"}}
        "#;
        let documents = read_all(text).unwrap();
        assert_eq!(
            documents,
            [
                doc! {
                    "name": "it's",
                    "n": 4,
                    "at": DateTime::from_millis(0),
                    "day": DateTime::from_millis(1_714_521_600_000),
                    "id": ObjectId::parse_str("64b7f0c2a1b2c3d4e5f60718").unwrap(),
                    "stamp": Timestamp { time: 1, increment: 2 },
                    "list": [1, 2],
                    "neg": -1500.0,
                    "big": 3_000_000_000_i64,
                },
                doc! { "x": 7_i64, "d": DateTime::from_millis(0) },
            ]
        );
    }

    /// Lines of an export in shell notation (`querymaster_test.export_types`).
    #[test]
    fn reads_an_export_in_shell_notation() {
        let text = "{
	\"n\": NumberInt(42),
	\"legacy\": LUUID(\"30313233-3435-3637-3839-616263646566\"),
	\"md5\": MD5(\"66656463626139383736353433323130\"),
	\"min\": MinKey,
	\"symbol\": Symbol(\"sym\")
}";
        let read = read_all(text).unwrap();
        assert_eq!(
            read,
            [doc! {
                "n": 42,
                "legacy": Binary { subtype: BinarySubtype::UuidOld, bytes: b"0123456789abcdef".to_vec() },
                "md5": Binary { subtype: BinarySubtype::Md5, bytes: b"fedcba9876543210".to_vec() },
                "min": Bson::MinKey,
                "symbol": Bson::Symbol("sym".into()),
            }]
        );
    }

    #[test]
    fn says_where_the_text_breaks() {
        let error = read_all("{ \"a\": 1 }\r\n{\r\n\t\"b\": ObjectId(\"nope\")\r\n}").unwrap_err();
        assert!(
            matches!(&error, Error::ImportText(at) if at.starts_with("3:7 ObjectId(\"nope\")")),
            "{error:?}"
        );
        assert!(matches!(read_all("[1]"), Err(Error::ImportShape)));
        assert!(matches!(read_all("[{}"), Err(Error::ImportText(_))));
        assert_eq!(read_all("  \r\n").unwrap(), Vec::<Document>::new());
        assert_eq!(read_all("[]").unwrap(), Vec::<Document>::new());
    }
}
