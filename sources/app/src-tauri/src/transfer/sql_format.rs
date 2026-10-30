//! SQL: one `INSERT` per document for MySQL, SQL Server, Oracle or PostgreSQL, optionally after a
//! `DROP TABLE IF EXISTS` and a `CREATE TABLE`. The columns are the chosen field paths, or the
//! fields of the first level of the first batch; their types come from the values of that batch.
//! `_id` is the key of the table, binary data goes into binary columns;
//! nested values and the rarer BSON types go in as relaxed extended JSON text.

use chrono::DateTime;
use mongodb::bson::{Bson, Document};
use serde::Deserialize;

use super::csv_format::{columns_of, path_value};

const EOL: &str = "\r\n";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Dialect {
    MySql,
    MsSql,
    Oracle,
    PostgreSql,
}

/// The settings of the SQL page.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlOptions {
    pub dialect: Dialect,
    /// *Target schema or db*: put before the table name; empty for none.
    #[serde(default)]
    pub schema: String,
    pub create_table: bool,
    pub drop_table: bool,
}

/// What a column holds, as far as the first batch shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    /// Only `null` or missing so far.
    Unknown,
    Int,
    Long,
    Double,
    Decimal,
    Bool,
    Date,
    ObjectId,
    /// Binary data (also UUIDs): a binary column.
    Binary,
    Text,
}

impl Kind {
    fn of(value: &Bson) -> Self {
        match value {
            Bson::Null | Bson::Undefined => Self::Unknown,
            Bson::Int32(_) => Self::Int,
            Bson::Int64(_) => Self::Long,
            Bson::Double(_) => Self::Double,
            Bson::Decimal128(_) => Self::Decimal,
            Bson::Boolean(_) => Self::Bool,
            Bson::DateTime(_) => Self::Date,
            Bson::ObjectId(_) => Self::ObjectId,
            Bson::Binary(_) => Self::Binary,
            _ => Self::Text,
        }
    }

    /// The kind that holds both: numbers widen, anything else mixed becomes text.
    fn merge(self, other: Self) -> Self {
        use Kind::*;
        match (self, other) {
            (Unknown, kind) | (kind, Unknown) => kind,
            (a, b) if a == b => a,
            (Int, Long) | (Long, Int) => Long,
            (Int | Long | Double, Int | Long | Double) => Double,
            (Int | Long | Double | Decimal, Int | Long | Double | Decimal) => Decimal,
            _ => Text,
        }
    }
}

pub struct SqlWriter {
    options: SqlOptions,
    table: String,
    columns: Option<Vec<String>>,
    /// Names of the columns in the table, when they differ from the paths.
    names: Option<Vec<String>>,
    kinds: Vec<Kind>,
    started: bool,
}

impl SqlWriter {
    /// `table` is the bare name (the collection's); `columns` as for CSV.
    pub fn new(options: SqlOptions, table: &str, columns: Option<Vec<String>>) -> Self {
        let name = quote_identifier(options.dialect, table);
        let table = if options.schema.trim().is_empty() {
            name
        } else {
            format!(
                "{}.{name}",
                quote_identifier(options.dialect, options.schema.trim())
            )
        };
        Self {
            options,
            table,
            columns: columns.filter(|columns| !columns.is_empty()),
            kinds: Vec::new(),
            names: None,
            started: false,
        }
    }

    /// Names of the table's columns, one per chosen column (renamed on the schema page).
    pub fn with_names(mut self, names: Option<Vec<String>>) -> Self {
        self.names = names;
        self
    }

    /// The name of the column at `index`: renamed, or the path with `_` for `.`.
    fn name_at(&self, index: usize, path: &str) -> String {
        let renamed = self
            .names
            .as_ref()
            .filter(|names| Some(names.len()) == self.columns.as_ref().map(Vec::len))
            .and_then(|names| names.get(index));
        renamed.cloned().unwrap_or_else(|| column_name(path))
    }

    /// The statements for a batch; the first one also gets the `DROP` and `CREATE` asked for.
    pub fn batch(&mut self, documents: &[Document]) -> String {
        let mut out = String::new();
        if !self.started {
            out.push_str(&self.head(documents));
        }
        let columns = self.columns.as_deref().unwrap_or_default();
        if columns.is_empty() {
            return out;
        }
        let names = columns
            .iter()
            .enumerate()
            .map(|(index, column)| {
                quote_identifier(self.options.dialect, &self.name_at(index, column))
            })
            .collect::<Vec<_>>()
            .join(", ");
        for document in documents {
            let values = columns
                .iter()
                .zip(&self.kinds)
                .map(|(column, kind)| {
                    path_value(document, column)
                        .map_or_else(|| "NULL".to_owned(), |value| self.literal(value, *kind))
                })
                .collect::<Vec<_>>()
                .join(", ");
            out.push_str(&format!(
                "INSERT INTO {} ({names}) VALUES ({values});{EOL}",
                self.table
            ));
        }
        out
    }

    /// What is still due at the end: the `DROP`/`CREATE` of a collection without documents.
    pub fn finish(&mut self) -> String {
        if self.started {
            String::new()
        } else {
            self.head(&[])
        }
    }

    fn head(&mut self, documents: &[Document]) -> String {
        self.started = true;
        let columns = self
            .columns
            .get_or_insert_with(|| columns_of(documents))
            .clone();
        self.kinds = columns
            .iter()
            .map(|column| {
                documents
                    .iter()
                    .filter_map(|document| path_value(document, column))
                    .fold(Kind::Unknown, |kind, value| kind.merge(Kind::of(value)))
            })
            .collect();
        let mut out = String::new();
        if self.options.drop_table {
            out.push_str(&self.drop_statement());
        }
        if self.options.create_table && !columns.is_empty() {
            let dialect = self.options.dialect;
            //: `_id` is the key of the table, not null.
            let keyed = columns.iter().position(|column| column == "_id");
            let mut lines = columns
                .iter()
                .zip(&self.kinds)
                .enumerate()
                .map(|(index, (column, kind))| {
                    let name = quote_identifier(dialect, &self.name_at(index, column));
                    if column == "_id" {
                        format!("\t{name} {} NOT NULL", key_type_name(dialect, *kind))
                    } else {
                        format!("\t{name} {}", type_name(dialect, *kind))
                    }
                })
                .collect::<Vec<_>>();
            if let Some(index) = keyed {
                lines.push(format!(
                    "\tPRIMARY KEY ({})",
                    quote_identifier(dialect, &self.name_at(index, "_id"))
                ));
            }
            let lines = lines.join(&format!(",{EOL}"));
            out.push_str(&format!(
                "CREATE TABLE {} ({EOL}{lines}{EOL});{EOL}{EOL}",
                self.table
            ));
        }
        out
    }

    fn drop_statement(&self) -> String {
        match self.options.dialect {
            // Oracle before 23 knows no `IF EXISTS`: drop, and pass over "table does not exist".
            Dialect::Oracle => format!(
                "BEGIN{EOL}\tEXECUTE IMMEDIATE 'DROP TABLE {}';{EOL}EXCEPTION{EOL}\tWHEN OTHERS THEN{EOL}\t\tIF SQLCODE != -942 THEN RAISE; END IF;{EOL}END;{EOL}/{EOL}{EOL}",
                self.table.replace('\'', "''")
            ),
            _ => format!("DROP TABLE IF EXISTS {};{EOL}{EOL}", self.table),
        }
    }

    /// A value as the dialect writes it; a text column takes everything as text.
    fn literal(&self, value: &Bson, kind: Kind) -> String {
        let dialect = self.options.dialect;
        if kind == Kind::Text {
            return match value {
                Bson::Null | Bson::Undefined => "NULL".into(),
                Bson::String(text) => string_literal(dialect, text),
                other => string_literal(dialect, &plain_text(other)),
            };
        }
        match value {
            Bson::Null | Bson::Undefined => "NULL".into(),
            Bson::Int32(number) => number.to_string(),
            Bson::Int64(number) => number.to_string(),
            Bson::Double(number) if number.is_finite() => format!("{number:?}"),
            Bson::Double(_) => "NULL".into(),
            Bson::Decimal128(number) => {
                let text = number.to_string();
                if text.chars().any(|c| c.is_ascii_digit()) && !text.contains("Inf") {
                    text
                } else {
                    "NULL".into()
                }
            }
            Bson::Boolean(flag) => match dialect {
                Dialect::MySql | Dialect::PostgreSql => if *flag { "TRUE" } else { "FALSE" }.into(),
                Dialect::MsSql | Dialect::Oracle => if *flag { "1" } else { "0" }.into(),
            },
            Bson::DateTime(date) => date_literal(dialect, date.timestamp_millis())
                .unwrap_or_else(|| string_literal(dialect, &plain_text(value))),
            Bson::Binary(binary) => binary_literal(dialect, &binary.bytes),
            Bson::String(text) => string_literal(dialect, text),
            other => string_literal(dialect, &plain_text(other)),
        }
    }
}

/// A dotted path as a column name: `customer.city` becomes `customer_city`.
fn column_name(path: &str) -> String {
    path.replace('.', "_")
}

fn quote_identifier(dialect: Dialect, name: &str) -> String {
    match dialect {
        Dialect::MySql => format!("`{}`", name.replace('`', "``")),
        Dialect::MsSql => format!("[{}]", name.replace(']', "]]")),
        Dialect::Oracle | Dialect::PostgreSql => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

fn string_literal(dialect: Dialect, text: &str) -> String {
    match dialect {
        // MySQL reads a backslash in a literal as the start of an escape.
        Dialect::MySql => format!("'{}'", text.replace('\\', "\\\\").replace('\'', "''")),
        // Unicode literal, or anything outside the code page is lost.
        Dialect::MsSql => format!("N'{}'", text.replace('\'', "''")),
        Dialect::Oracle | Dialect::PostgreSql => format!("'{}'", text.replace('\'', "''")),
    }
}

/// Bytes as the dialect writes binary data.
fn binary_literal(dialect: Dialect, bytes: &[u8]) -> String {
    let hex: String = bytes.iter().map(|byte| format!("{byte:02X}")).collect();
    match dialect {
        Dialect::MySql => format!("X'{hex}'"),
        Dialect::MsSql => format!("0x{hex}"),
        Dialect::Oracle => format!("HEXTORAW('{hex}')"),
        Dialect::PostgreSql => format!("'\\x{hex}'::bytea"),
    }
}

fn date_literal(dialect: Dialect, millis: i64) -> Option<String> {
    let date = DateTime::from_timestamp_millis(millis)?;
    Some(match dialect {
        Dialect::MySql | Dialect::PostgreSql => {
            format!("'{}'", date.format("%Y-%m-%d %H:%M:%S%.3f"))
        }
        Dialect::MsSql => format!("'{}'", date.format("%Y-%m-%dT%H:%M:%S%.3f")),
        Dialect::Oracle => format!("TIMESTAMP '{}'", date.format("%Y-%m-%d %H:%M:%S%.3f")),
    })
}

/// A value as text for a text column: plain for scalars, relaxed extended JSON for the rest.
fn plain_text(value: &Bson) -> String {
    match value {
        Bson::String(text) => text.clone(),
        Bson::ObjectId(id) => id.to_hex(),
        Bson::Int32(number) => number.to_string(),
        Bson::Int64(number) => number.to_string(),
        Bson::Double(number) => format!("{number:?}"),
        Bson::Decimal128(number) => number.to_string(),
        Bson::Boolean(flag) => flag.to_string(),
        Bson::DateTime(date) => date
            .try_to_rfc3339_string()
            .unwrap_or_else(|_| date.timestamp_millis().to_string()),
        other => other.clone().into_relaxed_extjson().to_string(),
    }
}

/// The type of the key column: a text or binary key gets a length, as a key column needs one
/// (MySQL, SQL Server and Oracle refuse a key on their unbounded text types).
fn key_type_name(dialect: Dialect, kind: Kind) -> &'static str {
    match (kind, dialect) {
        (Kind::Text | Kind::Unknown | Kind::Binary, Dialect::MySql) => "VARCHAR(255)",
        (Kind::Text | Kind::Unknown | Kind::Binary, Dialect::MsSql) => "NVARCHAR(450)",
        (Kind::Text | Kind::Unknown | Kind::Binary, Dialect::Oracle) => "NVARCHAR2(1000)",
        (Kind::Text | Kind::Unknown | Kind::Binary, Dialect::PostgreSql) => "TEXT",
        _ => type_name(dialect, kind),
    }
}

fn type_name(dialect: Dialect, kind: Kind) -> &'static str {
    use Dialect::*;
    use Kind::*;
    match (kind, dialect) {
        (Int, Oracle) => "NUMBER(10)",
        (Int, PostgreSql) => "INTEGER",
        (Int, _) => "INT",
        (Long, Oracle) => "NUMBER(19)",
        (Long, _) => "BIGINT",
        (Double, MySql) => "DOUBLE",
        (Double, MsSql) => "FLOAT",
        (Double, Oracle) => "BINARY_DOUBLE",
        (Double, PostgreSql) => "DOUBLE PRECISION",
        (Decimal, Oracle) => "NUMBER",
        (Decimal, PostgreSql) => "NUMERIC",
        (Decimal, _) => "DECIMAL(38, 10)",
        (Bool, MsSql) => "BIT",
        (Bool, Oracle) => "NUMBER(1)",
        (Bool, _) => "BOOLEAN",
        (Date, MySql) => "DATETIME(3)",
        (Date, MsSql) => "DATETIME2(3)",
        (Date, _) => "TIMESTAMP(3)",
        (ObjectId, Oracle) => "VARCHAR2(24)",
        (ObjectId, _) => "VARCHAR(24)",
        (Binary, MySql) => "LONGBLOB",
        (Binary, MsSql) => "VARBINARY(MAX)",
        (Binary, Oracle) => "BLOB",
        (Binary, PostgreSql) => "BYTEA",
        (Text | Unknown, MySql) => "LONGTEXT",
        (Text | Unknown, MsSql) => "NVARCHAR(MAX)",
        (Text | Unknown, Oracle) => "NCLOB",
        (Text | Unknown, PostgreSql) => "TEXT",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::{doc, oid::ObjectId, DateTime as BsonDate, Decimal128};

    fn options(dialect: Dialect, create: bool, drop: bool) -> SqlOptions {
        SqlOptions {
            dialect,
            schema: String::new(),
            create_table: create,
            drop_table: drop,
        }
    }

    fn sample() -> Vec<Document> {
        vec![
            doc! {
                "_id": ObjectId::parse_str("64b7f0c2a1b2c3d4e5f60718").unwrap(),
                "name": "O'Brien \\ Co",
                "n": 1,
                "at": BsonDate::from_millis(1_714_521_600_000),
                "ok": true,
                "tags": ["a"],
            },
            doc! { "_id": 2, "n": 2.5, "ok": null },
        ]
    }

    #[test]
    fn writes_create_and_inserts_for_postgresql() {
        let mut writer = SqlWriter::new(
            SqlOptions {
                schema: "shop".into(),
                ..options(Dialect::PostgreSql, true, true)
            },
            "orders",
            None,
        );
        let text = writer.batch(&sample()) + &writer.finish();
        assert_eq!(
            text,
            "DROP TABLE IF EXISTS \"shop\".\"orders\";\r\n\r\n\
             CREATE TABLE \"shop\".\"orders\" (\r\n\
             \t\"_id\" TEXT NOT NULL,\r\n\
             \t\"name\" TEXT,\r\n\
             \t\"n\" DOUBLE PRECISION,\r\n\
             \t\"at\" TIMESTAMP(3),\r\n\
             \t\"ok\" BOOLEAN,\r\n\
             \t\"tags\" TEXT,\r\n\
             \tPRIMARY KEY (\"_id\")\r\n\
             );\r\n\r\n\
             INSERT INTO \"shop\".\"orders\" (\"_id\", \"name\", \"n\", \"at\", \"ok\", \"tags\") VALUES ('64b7f0c2a1b2c3d4e5f60718', 'O''Brien \\ Co', 1, '2024-05-01 00:00:00.000', TRUE, '[\"a\"]');\r\n\
             INSERT INTO \"shop\".\"orders\" (\"_id\", \"name\", \"n\", \"at\", \"ok\", \"tags\") VALUES ('2', NULL, 2.5, NULL, NULL, NULL);\r\n"
        );
    }

    #[test]
    fn writes_binary_data_and_a_key_each_dialect_takes() {
        use mongodb::bson::{spec::BinarySubtype, Binary};
        let documents = [doc! {
            "_id": ObjectId::parse_str("64b7f0c2a1b2c3d4e5f60718").unwrap(),
            "bin": Binary { subtype: BinarySubtype::Generic, bytes: b"hi".to_vec() },
        }];
        let text = |dialect| {
            let mut writer = SqlWriter::new(options(dialect, true, false), "t", None);
            writer.batch(&documents)
        };
        let mysql = text(Dialect::MySql);
        assert!(
            mysql.contains(
                "\t`_id` VARCHAR(24) NOT NULL,\r\n\t`bin` LONGBLOB,\r\n\tPRIMARY KEY (`_id`)\r\n"
            ),
            "{mysql}"
        );
        assert!(
            mysql.ends_with("VALUES ('64b7f0c2a1b2c3d4e5f60718', X'6869');\r\n"),
            "{mysql}"
        );
        assert!(text(Dialect::MsSql).contains("0x6869);"));
        assert!(text(Dialect::Oracle).contains("HEXTORAW('6869'));"));
        assert!(text(Dialect::PostgreSql).contains("'\\x6869'::bytea);"));
        // A key of mixed values is text with a length a key column takes.
        let mut mixed = SqlWriter::new(options(Dialect::MySql, true, false), "t", None);
        assert!(mixed
            .batch(&[doc! { "_id": 1 }, doc! { "_id": "a" }])
            .contains("\t`_id` VARCHAR(255) NOT NULL,\r\n"));
    }

    #[test]
    fn names_the_columns_as_renamed() {
        let mut writer = SqlWriter::new(
            options(Dialect::PostgreSql, true, false),
            "t",
            Some(vec!["_id".into(), "customer.city".into()]),
        )
        .with_names(Some(vec!["id".into(), "Stadt".into()]));
        let text = writer.batch(&[doc! { "_id": 1, "customer": { "city": "Ulm" } }]);
        assert!(
            text.contains(
                "\t\"id\" INTEGER NOT NULL,\r\n\t\"Stadt\" TEXT,\r\n\tPRIMARY KEY (\"id\")"
            ),
            "{text}"
        );
        assert!(
            text.contains("(\"id\", \"Stadt\") VALUES (1, 'Ulm');"),
            "{text}"
        );
    }

    #[test]
    fn quotes_and_writes_values_as_each_dialect_does() {
        let documents =
            [doc! { "name": "O'Brien \\ Co", "ok": false, "at": BsonDate::from_millis(0) }];
        let line = |dialect| {
            let mut writer = SqlWriter::new(options(dialect, false, false), "t", None);
            writer.batch(&documents)
        };
        assert_eq!(
            line(Dialect::MySql),
            "INSERT INTO `t` (`name`, `ok`, `at`) VALUES ('O''Brien \\\\ Co', FALSE, '1970-01-01 00:00:00.000');\r\n"
        );
        assert_eq!(
            line(Dialect::MsSql),
            "INSERT INTO [t] ([name], [ok], [at]) VALUES (N'O''Brien \\ Co', 0, '1970-01-01T00:00:00.000');\r\n"
        );
        assert_eq!(
            line(Dialect::Oracle),
            "INSERT INTO \"t\" (\"name\", \"ok\", \"at\") VALUES ('O''Brien \\ Co', 0, TIMESTAMP '1970-01-01 00:00:00.000');\r\n"
        );
    }

    #[test]
    fn drops_in_oracle_with_a_block_and_types_its_columns() {
        let mut writer = SqlWriter::new(
            options(Dialect::Oracle, true, true),
            "it's",
            Some(vec![
                "n".into(),
                "big".into(),
                "price".into(),
                "flag".into(),
            ]),
        );
        let text = writer.batch(&[doc! {
            "n": 1,
            "big": 9_007_199_254_740_993_i64,
            "price": Decimal128::from_bytes([0; 16]),
            "flag": true,
        }]);
        assert!(text.starts_with(
            "BEGIN\r\n\tEXECUTE IMMEDIATE 'DROP TABLE \"it''s\"';\r\nEXCEPTION\r\n\tWHEN OTHERS THEN\r\n\t\tIF SQLCODE != -942 THEN RAISE; END IF;\r\nEND;\r\n/\r\n\r\n"
        ));
        assert!(text.contains(
            "\t\"n\" NUMBER(10),\r\n\t\"big\" NUMBER(19),\r\n\t\"price\" NUMBER,\r\n\t\"flag\" NUMBER(1)\r\n"
        ));
    }

    #[test]
    fn takes_chosen_paths_and_names_them_with_underscores() {
        let mut writer = SqlWriter::new(
            options(Dialect::MsSql, true, false),
            "people",
            Some(vec!["customer.city".into(), "missing".into()]),
        );
        assert_eq!(
            writer.batch(&[doc! { "customer": { "city": "Ulm" } }]),
            "CREATE TABLE [people] (\r\n\t[customer_city] NVARCHAR(MAX),\r\n\t[missing] NVARCHAR(MAX)\r\n);\r\n\r\n\
             INSERT INTO [people] ([customer_city], [missing]) VALUES (N'Ulm', NULL);\r\n"
        );
    }

    #[test]
    fn writes_only_the_table_for_a_collection_without_documents() {
        let mut writer = SqlWriter::new(options(Dialect::MySql, true, true), "empty", None);
        assert_eq!(writer.finish(), "DROP TABLE IF EXISTS `empty`;\r\n\r\n");
        let mut chosen = SqlWriter::new(
            options(Dialect::MySql, true, false),
            "empty",
            Some(vec!["a".into()]),
        );
        assert_eq!(
            chosen.finish(),
            "CREATE TABLE `empty` (\r\n\t`a` LONGTEXT\r\n);\r\n\r\n"
        );
    }
}
