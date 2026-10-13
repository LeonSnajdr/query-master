//! One run of a script: a fresh engine, the runtime loaded into it, the script evaluated, its last
//! value handed back. Runs on a blocking thread; database calls block it, which makes the API the
//! script sees synchronous, as in the shell.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use futures_util::TryStreamExt;
use mongodb::bson::Document;
use mongodb::{Client, Cursor};
use rquickjs::{CatchResultExt, Context, Ctx, Exception, Function, Object, Runtime};
use serde::Deserialize;
use serde_json::Value;

use super::ScriptResult;
use crate::error::{Error, Result};
use crate::mongo::{to_document, to_json};

/// What a script sees, bundled from `src/shell/runtime` (`bun run build:runtime`).
const RUNTIME: &str = include_str!("../../script/runtime.js");
/// Memory the engine may take before the script fails.
const MEMORY_LIMIT: usize = 512 * 1024 * 1024;
const STACK_SIZE: usize = 1024 * 1024;
/// Printed text kept; a script that prints in a loop does not fill the memory.
const OUTPUT_LIMIT: usize = 10 * 1024 * 1024;
/// Thrown inside the engine for a write in a read-only tab, and recognised when it comes back out.
const READ_ONLY: &str = "__querymaster_read_only__";

/// Commands that change data or structure; the same list as `WRITE_COMMANDS` in `src/shell/plan.ts`.
const WRITE_COMMANDS: [&str; 26] = [
    "insert",
    "update",
    "delete",
    "findAndModify",
    "create",
    "drop",
    "dropDatabase",
    "createIndexes",
    "dropIndexes",
    "renameCollection",
    "collMod",
    "createSearchIndexes",
    "updateSearchIndex",
    "dropSearchIndex",
    "killOp",
    "profile",
    "createUser",
    "updateUser",
    "dropUser",
    "createRole",
    "dropRole",
    "grantRolesToUser",
    "revokeRolesFromUser",
    "compact",
    "bulkWrite",
    "setParameter",
];

fn is_write(command: &Document) -> bool {
    let Some(name) = command.keys().next() else {
        return false;
    };
    if WRITE_COMMANDS.contains(&name.as_str()) {
        return true;
    }
    // A pipeline that ends in `$out` or `$merge` writes too.
    command
        .get_array("pipeline")
        .ok()
        .and_then(|pipeline| pipeline.last())
        .and_then(|stage| stage.as_document())
        .and_then(|stage| stage.keys().next())
        .is_some_and(|stage| stage == "$out" || stage == "$merge")
}

#[derive(Default)]
struct State {
    cursors: HashMap<i32, Cursor<Document>>,
    next_handle: i32,
    output: String,
}

#[derive(Deserialize)]
struct Finished {
    items: Vec<Value>,
    truncated: bool,
}

fn throw(ctx: &Ctx<'_>, message: impl std::fmt::Display) -> rquickjs::Error {
    Exception::throw_message(ctx, &message.to_string())
}

/// The command a script sends, checked against the read-only switch of its tab.
fn command_of(ctx: &Ctx<'_>, json: &str, readonly: bool) -> rquickjs::Result<Document> {
    let value: Value = serde_json::from_str(json).map_err(|e| throw(ctx, e))?;
    let command = to_document(value).map_err(|e| throw(ctx, e))?;
    if readonly && is_write(&command) {
        return Err(throw(ctx, READ_ONLY));
    }
    Ok(command)
}

/// Puts the functions of this side into the engine: `__command`, `__cursorOpen` …
fn install<'js>(
    ctx: &Ctx<'js>,
    client: &Client,
    readonly: bool,
    state: &Rc<RefCell<State>>,
) -> rquickjs::Result<()> {
    let globals = ctx.globals();

    let print = {
        let state = state.clone();
        move |text: String| {
            let output = &mut state.borrow_mut().output;
            if output.len() < OUTPUT_LIMIT {
                output.push_str(&text);
                output.push('\n');
            }
        }
    };
    globals.set("__print", Function::new(ctx.clone(), print)?)?;

    let command = {
        let client = client.clone();
        move |ctx: Ctx<'js>, database: String, json: String| -> rquickjs::Result<String> {
            let command = command_of(&ctx, &json, readonly)?;
            let reply = tauri::async_runtime::block_on(async {
                client.database(&database).run_command(command).await
            })
            .map_err(|e| throw(&ctx, e))?;
            Ok(to_json(reply).to_string())
        }
    };
    globals.set("__command", Function::new(ctx.clone(), command)?)?;

    let cursor_open = {
        let (client, state) = (client.clone(), state.clone());
        move |ctx: Ctx<'js>, database: String, json: String| -> rquickjs::Result<i32> {
            let command = command_of(&ctx, &json, readonly)?;
            let cursor = tauri::async_runtime::block_on(async {
                client.database(&database).run_cursor_command(command).await
            })
            .map_err(|e| throw(&ctx, e))?;
            let mut state = state.borrow_mut();
            state.next_handle += 1;
            let handle = state.next_handle;
            state.cursors.insert(handle, cursor);
            Ok(handle)
        }
    };
    globals.set("__cursorOpen", Function::new(ctx.clone(), cursor_open)?)?;

    let cursor_next = {
        let state = state.clone();
        move |ctx: Ctx<'js>, handle: i32, count: usize| -> rquickjs::Result<String> {
            // Taken out of the map while it is read: the state is not borrowed across the wait.
            let Some(mut cursor) = state.borrow_mut().cursors.remove(&handle) else {
                return Ok("[]".to_owned());
            };
            let mut documents = Vec::with_capacity(count);
            let mut exhausted = false;
            while documents.len() < count {
                match tauri::async_runtime::block_on(cursor.try_next())
                    .map_err(|e| throw(&ctx, e))?
                {
                    Some(document) => documents.push(to_json(document)),
                    None => {
                        exhausted = true;
                        break;
                    }
                }
            }
            if !exhausted {
                state.borrow_mut().cursors.insert(handle, cursor);
            }
            Ok(Value::Array(documents).to_string())
        }
    };
    globals.set("__cursorNext", Function::new(ctx.clone(), cursor_next)?)?;

    let cursor_close = {
        let state = state.clone();
        move |handle: i32| {
            state.borrow_mut().cursors.remove(&handle);
        }
    };
    globals.set("__cursorClose", Function::new(ctx.clone(), cursor_close)?)?;
    Ok(())
}

/// What went wrong inside the engine, as the error the frontend shows.
fn failure(message: String, stop: &AtomicBool) -> Error {
    if message.contains(READ_ONLY) {
        Error::ReadOnly
    } else if stop.load(Ordering::Relaxed) {
        Error::ScriptStopped
    } else {
        Error::Script(message)
    }
}

pub fn run(
    client: &Client,
    database: &str,
    source: &str,
    readonly: bool,
    stop: &Arc<AtomicBool>,
) -> Result<ScriptResult> {
    let engine_error = |e: rquickjs::Error| Error::Script(e.to_string());
    let runtime = Runtime::new().map_err(engine_error)?;
    runtime.set_memory_limit(MEMORY_LIMIT);
    runtime.set_max_stack_size(STACK_SIZE);
    // Asked between the steps of the script: `true` ends it, also out of an endless loop.
    let flag = stop.clone();
    runtime.set_interrupt_handler(Some(Box::new(move || flag.load(Ordering::Relaxed))));
    let context = Context::full(&runtime).map_err(engine_error)?;
    let state = Rc::new(RefCell::new(State::default()));

    let finished = context.with(|ctx| -> std::result::Result<Finished, String> {
        let caught = |e: rquickjs::Error| e.to_string();
        install(&ctx, client, readonly, &state).map_err(caught)?;
        ctx.eval::<(), _>(RUNTIME)
            .catch(&ctx)
            .map_err(|e| e.to_string())?;
        let api: Object = ctx.globals().get("__qm").map_err(caught)?;
        let setup: Function = api.get("setup").map_err(caught)?;
        setup
            .call::<_, ()>((database,))
            .catch(&ctx)
            .map_err(|e| e.to_string())?;

        let value: rquickjs::Value = ctx.eval(source).catch(&ctx).map_err(|e| e.to_string())?;
        let finish: Function = api.get("finish").map_err(caught)?;
        let json: String = finish
            .call((value,))
            .catch(&ctx)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&json).map_err(|e| e.to_string())
    });

    // Cursors the script left open are closed with the state; the output is kept either way.
    let output = std::mem::take(&mut state.borrow_mut().output);
    state.borrow_mut().cursors.clear();
    match finished {
        Ok(finished) => Ok(ScriptResult {
            items: finished.items,
            truncated: finished.truncated,
            output,
        }),
        Err(message) => Err(failure(message, stop)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mongodb::bson::doc;
    use serde_json::json;

    /// A client that is never asked: these scripts do not touch the database.
    async fn offline() -> Client {
        Client::with_uri_str("mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=200")
            .await
            .unwrap()
    }

    fn run_blocking(
        client: Client,
        source: &'static str,
        stop: Arc<AtomicBool>,
    ) -> Result<ScriptResult> {
        std::thread::spawn(move || run(&client, "shop", source, false, &stop))
            .join()
            .unwrap()
    }

    #[test]
    fn knows_what_writes() {
        assert!(is_write(&doc! { "insert": "c", "documents": [] }));
        assert!(is_write(
            &doc! { "aggregate": "c", "pipeline": [{ "$match": {} }, { "$out": "x" }] }
        ));
        assert!(!is_write(
            &doc! { "aggregate": "c", "pipeline": [{ "$match": {} }] }
        ));
        assert!(!is_write(&doc! { "find": "c" }));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn runs_code_and_returns_the_last_value() {
        let source = r#"
            var total = 0;
            [1, 2, 3].forEach(function (n) { total += n; });
            print("sum", total);
            printjson({ id: ObjectId("64b7f0c2a1b2c3d4e5f60718"), n: NumberLong(5) });
            ({ total: total, at: ISODate("2024-05-01"), big: NumberLong("9007199254740993") })
        "#;
        let result = run_blocking(offline().await, source, Arc::default()).unwrap();
        assert_eq!(
            result.items,
            vec![json!({
                "total": 6,
                "at": { "$date": { "$numberLong": "1714521600000" } },
                "big": { "$numberLong": "9007199254740993" }
            })]
        );
        assert!(result.output.starts_with("sum 6\n"));
        assert!(result
            .output
            .contains("ObjectId(\"64b7f0c2a1b2c3d4e5f60718\")"));
        assert!(result.output.contains("NumberLong(5)"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn reports_errors_with_their_place() {
        let error =
            run_blocking(offline().await, "var a = 1;\nnope();", Arc::default()).unwrap_err();
        let Error::Script(message) = error else {
            panic!("expected a script error");
        };
        assert!(message.contains("nope is not defined"), "{message}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn has_no_way_out_of_the_engine() {
        let source =
            "[typeof require, typeof process, typeof fetch, typeof XMLHttpRequest, typeof Deno]";
        let result = run_blocking(offline().await, source, Arc::default()).unwrap();
        assert_eq!(result.items, vec![json!("undefined"); 5]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn an_endless_loop_can_be_stopped() {
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(200));
            flag.store(true, Ordering::Relaxed);
        });
        let error = run_blocking(offline().await, "for (;;) {}", stop).unwrap_err();
        assert!(matches!(error, Error::ScriptStopped));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn read_only_refuses_writes_from_scripts() {
        let client = offline().await;
        let stop = Arc::default();
        let error = std::thread::spawn(move || {
            run(
                &client,
                "shop",
                "db.orders.insertOne({ a: 1 })",
                true,
                &stop,
            )
        })
        .join()
        .unwrap()
        .unwrap_err();
        assert!(matches!(error, Error::ReadOnly));
    }
}
