//! What copying a collection needs, for the export into a database (the one way collections are
//! copied, also when pasted): the options of the source (capped, validator, time series, view
//! definition …) and its indexes. The documents go through the export job.

use futures_util::TryStreamExt;
use mongodb::{
    bson::{doc, Bson, Document},
    Client,
};

use crate::error::{Error, Result};

/// The server's answer when the collection to create is there already.
pub(crate) const NAMESPACE_EXISTS: i32 = 48;

/// What `listCollections` says about one collection.
pub(crate) async fn describe(
    client: &Client,
    database: &str,
    collection: &str,
) -> Result<Document> {
    let mut cursor = client
        .database(database)
        .run_cursor_command(doc! { "listCollections": 1, "filter": { "name": collection } })
        .await?;
    match cursor.try_next().await? {
        Some(info) => Ok(info),
        None => Err(Error::CollectionMissing(format!("{database}.{collection}"))),
    }
}

/// The `create` command for a collection like the one described.
pub(crate) fn create_command(name: &str, info: &Document) -> Document {
    let mut command = doc! { "create": name };
    if let Ok(options) = info.get_document("options") {
        for (key, value) in options {
            let mut value = value.clone();
            // The version of the clustered index is the server's to choose.
            if let (true, Bson::Document(index)) = (key == "clusteredIndex", &mut value) {
                index.remove("v");
            }
            command.insert(key, value);
        }
    }
    command
}

/// The index specifications to create on the copy: all but the one on `_id`, without what the
/// server sets itself.
pub(crate) fn index_specs(indexes: Vec<Document>) -> Vec<Document> {
    indexes
        .into_iter()
        .filter(|index| index.get_str("name") != Ok("_id_"))
        .map(|mut index| {
            index.remove("v");
            index.remove("ns");
            index
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_the_copy_with_the_options_of_the_source() {
        let info = doc! {
            "name": "events",
            "type": "collection",
            "options": {
                "capped": true,
                "size": 4096,
                "validator": { "n": { "$type": "int" } },
                "clusteredIndex": { "v": 2, "key": { "_id": 1 }, "unique": true },
            },
            "info": { "readOnly": false },
        };
        assert_eq!(
            create_command("copy", &info),
            doc! {
                "create": "copy",
                "capped": true,
                "size": 4096,
                "validator": { "n": { "$type": "int" } },
                "clusteredIndex": { "key": { "_id": 1 }, "unique": true },
            }
        );
    }

    #[test]
    fn copies_every_index_but_the_one_on_id() {
        let specs = index_specs(vec![
            doc! { "v": 2, "key": { "_id": 1 }, "name": "_id_" },
            doc! { "v": 2, "key": { "a": 1 }, "name": "a_1", "unique": true, "ns": "x.y" },
        ]);
        assert_eq!(
            specs,
            vec![doc! { "key": { "a": 1 }, "name": "a_1", "unique": true }]
        );
    }
}
