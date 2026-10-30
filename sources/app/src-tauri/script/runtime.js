var QueryMasterRuntime = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region src/shell/ejson.ts
	function isDoc(value) {
		return typeof value === "object" && value !== null && !Array.isArray(value);
	}
	/** A plain number out of a number in either notation (`5`, `{ $numberInt: "5" }` …). */
	function toNumber(value) {
		if (typeof value === "number") return value;
		if (!isDoc(value)) return void 0;
		const wrapped = value.$numberInt ?? value.$numberLong ?? value.$numberDouble ?? value.$numberDecimal;
		return typeof wrapped === "string" ? Number(wrapped) : void 0;
	}
	function objectId(hex) {
		return { $oid: hex };
	}
	function randomHex(bytes) {
		return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
	}
	/** A new ObjectId: seconds since 1970, then random bytes (the counter part is random here too). */
	function newObjectId(now = Date.now()) {
		return objectId(Math.floor(now / 1e3).toString(16).padStart(8, "0") + randomHex(8));
	}
	function uuidText(base64) {
		const hex = Array.from(atob(base64), (char) => char.charCodeAt(0).toString(16).padStart(2, "0")).join("");
		return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
	}
	function isoDate$1(value) {
		const milliseconds = isDoc(value) ? toNumber(value) : typeof value === "number" ? value : void 0;
		if (milliseconds === void 0) return String(value);
		const parsed = new Date(milliseconds);
		return Number.isNaN(parsed.getTime()) ? String(milliseconds) : parsed.toISOString();
	}
	/** The scalar a wrapped value stands for, or `undefined` for a document of the user. */
	function unwrap(value) {
		const keys = Object.keys(value);
		const first = keys[0];
		if (first === void 0 || !first.startsWith("$") || keys.length > 2) return void 0;
		const inner = value[first];
		switch (first) {
			case "$oid": return {
				type: "objectId",
				text: `ObjectId("${String(inner)}")`
			};
			case "$date": return {
				type: "date",
				text: `ISODate("${isoDate$1(inner)}")`
			};
			case "$numberInt": return {
				type: "int",
				text: String(inner)
			};
			case "$numberLong": return {
				type: "long",
				text: `NumberLong(${String(inner)})`
			};
			case "$numberDouble": {
				const text = String(inner);
				return {
					type: "double",
					text: /^-?\d+$/.test(text) ? `${text}.0` : text
				};
			}
			case "$numberDecimal": return {
				type: "decimal",
				text: `NumberDecimal("${String(inner)}")`
			};
			case "$regularExpression": return isDoc(inner) ? {
				type: "regex",
				text: `/${String(inner.pattern)}/${String(inner.options ?? "")}`
			} : void 0;
			case "$binary": {
				if (!isDoc(inner)) return void 0;
				const subType = String(inner.subType);
				const base64 = String(inner.base64);
				if (subType === "04" && base64.length === 24) return {
					type: "uuid",
					text: `UUID("${uuidText(base64)}")`
				};
				return {
					type: "binary",
					text: `BinData(${parseInt(subType, 16)}, "${base64}")`
				};
			}
			case "$timestamp": return isDoc(inner) ? {
				type: "timestamp",
				text: `Timestamp(${String(inner.t)}, ${String(inner.i)})`
			} : void 0;
			case "$minKey": return {
				type: "minKey",
				text: "MinKey()"
			};
			case "$maxKey": return {
				type: "maxKey",
				text: "MaxKey()"
			};
			case "$undefined": return {
				type: "undefined",
				text: "undefined"
			};
			case "$code": return {
				type: "code",
				text: `Code(${JSON.stringify(inner)})`
			};
			case "$symbol": return {
				type: "string",
				text: JSON.stringify(inner)
			};
			default: return;
		}
	}
	/** A value that has no children in the result tree, or `undefined` for documents and arrays. */
	function scalar(value) {
		if (value === null) return {
			type: "null",
			text: "null"
		};
		if (typeof value === "string") return {
			type: "string",
			text: JSON.stringify(value)
		};
		if (typeof value === "boolean") return {
			type: "bool",
			text: String(value)
		};
		if (typeof value === "number") return {
			type: Number.isInteger(value) ? "int" : "double",
			text: String(value)
		};
		if (Array.isArray(value)) return void 0;
		return unwrap(value);
	}
	var PLAIN_KEY = /^[A-Za-z_$][\w$]*$/;
	/** A key as the shell takes it: quoted only where it has to be. */
	function keyText(key) {
		return PLAIN_KEY.test(key) ? key : JSON.stringify(key);
	}
	/** A value as shell text, indented with four spaces; with `quoteKeys` every key is in quotes, as in JSON. */
	function toShell(value, indent = "", quoteKeys = false) {
		const leaf = scalar(value);
		if (leaf) return leaf.text;
		const inner = `${indent}    `;
		if (Array.isArray(value)) {
			if (value.length === 0) return "[]";
			return `[\n${value.map((item) => inner + toShell(item, inner, quoteKeys)).join(",\n")}\n${indent}]`;
		}
		const entries = Object.entries(value);
		if (entries.length === 0) return "{}";
		const key = (name) => quoteKeys ? JSON.stringify(name) : keyText(name);
		return `{\n${entries.map(([name, item]) => `${inner}${key(name)}: ${toShell(item, inner, quoteKeys)}`).join(",\n")}\n${indent}}`;
	}
	//#endregion
	//#region src/shell/message.ts
	/** A statement the shell does not take, with the place in the text. */
	var ShellError = class extends Error {
		key;
		params;
		position;
		constructor(key, params, position) {
			super(key);
			this.key = key;
			this.params = params;
			this.position = position;
			this.name = "ShellError";
		}
	};
	//#endregion
	//#region src/shell/plan.ts
	function doc(value, what) {
		if (value === void 0) return {};
		if (!isDoc(value)) throw new ShellError("error.plan.document", { what });
		return value;
	}
	function array(value, what) {
		if (!Array.isArray(value)) throw new ShellError("error.plan.array", { what });
		return value;
	}
	function string(value, what) {
		if (typeof value !== "string") throw new ShellError("error.plan.string", { what });
		return value;
	}
	function number(value, what) {
		const result = toNumber(value);
		if (result === void 0) throw new ShellError("error.plan.number", { what });
		return result;
	}
	/** A copy without the keys whose value is `undefined`. */
	function compact(source) {
		return Object.fromEntries(Object.entries(source).filter(([, value]) => value !== void 0));
	}
	function pick(source, keys) {
		return Object.fromEntries(Object.entries(source).filter(([key]) => keys.includes(key)));
	}
	function omit(source, keys) {
		return Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));
	}
	function field(reply, key) {
		return isDoc(reply) ? reply[key] ?? null : null;
	}
	function first(documents) {
		return Array.isArray(documents) ? documents[0] ?? null : null;
	}
	/** `{ a: 1, b: -1 }` becomes `a_1_b_-1`, the name drivers give an index. */
	function indexName(keys) {
		return Object.entries(keys).map(([key, direction]) => `${key}_${toNumber(direction) ?? String(direction)}`).join("_");
	}
	function withId(document) {
		const value = doc(document, "document");
		return "_id" in value ? value : {
			_id: newObjectId(),
			...value
		};
	}
	/** Options that belong to the single update or delete, not to the command around it. */
	var UPDATE_STATEMENT_OPTIONS = [
		"upsert",
		"arrayFilters",
		"collation",
		"hint",
		"sort"
	];
	var DELETE_STATEMENT_OPTIONS = ["collation", "hint"];
	function updateCommand(collection, args, multi) {
		const options = doc(args[2], "options");
		const update = args[1];
		if (!isDoc(update) && !Array.isArray(update)) throw new ShellError("error.plan.update");
		return {
			update: collection,
			updates: [{
				q: doc(args[0], "filter"),
				u: update,
				multi,
				...pick(options, UPDATE_STATEMENT_OPTIONS)
			}],
			...omit(options, [...UPDATE_STATEMENT_OPTIONS, "multi"])
		};
	}
	function updateResult(reply) {
		const upserted = first(field(reply, "upserted"));
		return {
			acknowledged: true,
			matchedCount: upserted ? 0 : field(reply, "n"),
			modifiedCount: field(reply, "nModified"),
			upsertedCount: upserted ? 1 : 0,
			upsertedId: field(upserted, "_id")
		};
	}
	function deleteCommand(collection, args, limit) {
		const options = doc(args[1], "options");
		return {
			delete: collection,
			deletes: [{
				q: doc(args[0], "filter"),
				limit,
				...pick(options, DELETE_STATEMENT_OPTIONS)
			}],
			...omit(options, DELETE_STATEMENT_OPTIONS)
		};
	}
	function deleteResult(reply) {
		return {
			acknowledged: true,
			deletedCount: field(reply, "n")
		};
	}
	function findAndModify(collection, args, change, optionsAt) {
		const options = doc(args[optionsAt], "options");
		const after = options.returnDocument === "after" || options.returnNewDocument === true;
		return compact({
			findAndModify: collection,
			query: doc(args[0], "filter"),
			...change,
			new: "remove" in change ? void 0 : after,
			fields: options.projection,
			...omit(options, [
				"returnDocument",
				"returnNewDocument",
				"projection"
			])
		});
	}
	var COLLECTION_METHODS = {
		find: (collection, args) => ({
			command: compact({
				find: collection,
				filter: doc(args[0], "filter"),
				projection: args[1] === void 0 ? void 0 : doc(args[1], "projection"),
				...doc(args[2], "options")
			}),
			cursor: true,
			paging: "find"
		}),
		findOne: (collection, args) => ({
			command: compact({
				find: collection,
				filter: doc(args[0], "filter"),
				projection: args[1] === void 0 ? void 0 : doc(args[1], "projection"),
				...doc(args[2], "options"),
				limit: 1,
				singleBatch: true
			}),
			cursor: true,
			shape: first
		}),
		aggregate: (collection, args) => ({
			command: {
				aggregate: collection,
				pipeline: args[0] === void 0 ? [] : array(args[0], "pipeline"),
				cursor: {},
				...doc(args[1], "options")
			},
			cursor: true,
			paging: "aggregate"
		}),
		countDocuments: (collection, args) => {
			const options = doc(args[1], "options");
			const pipeline = [{ $match: doc(args[0], "filter") }];
			if (options.skip !== void 0) pipeline.push({ $skip: options.skip });
			if (options.limit !== void 0) pipeline.push({ $limit: options.limit });
			pipeline.push({ $group: {
				_id: 1,
				n: { $sum: 1 }
			} });
			return {
				command: {
					aggregate: collection,
					pipeline,
					cursor: {},
					...omit(options, ["skip", "limit"])
				},
				cursor: true,
				shape: (documents) => field(first(documents), "n") ?? 0
			};
		},
		estimatedDocumentCount: (collection, args) => ({
			command: {
				count: collection,
				...doc(args[0], "options")
			},
			cursor: false,
			shape: (reply) => field(reply, "n")
		}),
		count: (collection, args) => ({
			command: {
				count: collection,
				query: doc(args[0], "filter"),
				...doc(args[1], "options")
			},
			cursor: false,
			shape: (reply) => field(reply, "n")
		}),
		distinct: (collection, args) => ({
			command: {
				distinct: collection,
				key: string(args[0], "field"),
				query: doc(args[1], "filter"),
				...doc(args[2], "options")
			},
			cursor: false,
			shape: (reply) => field(reply, "values")
		}),
		insertOne: (collection, args) => {
			const document = withId(args[0] ?? {});
			return {
				command: {
					insert: collection,
					documents: [document],
					...doc(args[1], "options")
				},
				cursor: false,
				shape: () => ({
					acknowledged: true,
					insertedId: document._id
				})
			};
		},
		insertMany: (collection, args) => {
			const documents = array(args[0], "documents").map(withId);
			return {
				command: {
					insert: collection,
					documents,
					...doc(args[1], "options")
				},
				cursor: false,
				shape: (reply) => ({
					acknowledged: true,
					insertedCount: field(reply, "n"),
					insertedIds: documents.map((document) => document._id)
				})
			};
		},
		insert: (collection, args, database) => (Array.isArray(args[0]) ? COLLECTION_METHODS.insertMany : COLLECTION_METHODS.insertOne)(collection, args, database),
		updateOne: (collection, args) => ({
			command: updateCommand(collection, args, false),
			cursor: false,
			shape: updateResult
		}),
		updateMany: (collection, args) => ({
			command: updateCommand(collection, args, true),
			cursor: false,
			shape: updateResult
		}),
		update: (collection, args) => ({
			command: updateCommand(collection, args, doc(args[2], "options").multi === true),
			cursor: false,
			shape: updateResult
		}),
		replaceOne: (collection, args) => {
			const replacement = doc(args[1], "replacement");
			if (Object.keys(replacement).some((key) => key.startsWith("$"))) throw new ShellError("error.plan.replacement");
			return {
				command: updateCommand(collection, args, false),
				cursor: false,
				shape: updateResult
			};
		},
		deleteOne: (collection, args) => ({
			command: deleteCommand(collection, args, 1),
			cursor: false,
			shape: deleteResult
		}),
		deleteMany: (collection, args) => ({
			command: deleteCommand(collection, args, 0),
			cursor: false,
			shape: deleteResult
		}),
		remove: (collection, args) => {
			const justOne = args[1] === true || isDoc(args[1]) && args[1].justOne === true;
			return {
				command: deleteCommand(collection, [args[0]], justOne ? 1 : 0),
				cursor: false,
				shape: deleteResult
			};
		},
		findOneAndUpdate: (collection, args) => ({
			command: findAndModify(collection, args, { update: args[1] ?? {} }, 2),
			cursor: false,
			shape: (reply) => field(reply, "value")
		}),
		findOneAndReplace: (collection, args) => ({
			command: findAndModify(collection, args, { update: doc(args[1], "replacement") }, 2),
			cursor: false,
			shape: (reply) => field(reply, "value")
		}),
		findOneAndDelete: (collection, args) => ({
			command: findAndModify(collection, args, { remove: true }, 1),
			cursor: false,
			shape: (reply) => field(reply, "value")
		}),
		findAndModify: (collection, args) => ({
			command: {
				findAndModify: collection,
				...doc(args[0], "argument")
			},
			cursor: false,
			shape: (reply) => field(reply, "value")
		}),
		createIndex: (collection, args) => {
			const key = doc(args[0], "keys");
			const options = doc(args[1], "options");
			return {
				command: {
					createIndexes: collection,
					indexes: [{
						key,
						name: indexName(key),
						...options
					}]
				},
				cursor: false
			};
		},
		createIndexes: (collection, args) => {
			const options = doc(args[1], "options");
			return {
				command: {
					createIndexes: collection,
					indexes: array(args[0], "keys").map((keys) => {
						const key = doc(keys, "keys");
						return {
							key,
							name: indexName(key),
							...options
						};
					})
				},
				cursor: false
			};
		},
		getIndexes: (collection) => ({
			command: { listIndexes: collection },
			cursor: true
		}),
		dropIndex: (collection, args) => ({
			command: {
				dropIndexes: collection,
				index: args[0] ?? "*"
			},
			cursor: false
		}),
		dropIndexes: (collection, args) => ({
			command: {
				dropIndexes: collection,
				index: args[0] ?? "*"
			},
			cursor: false
		}),
		hideIndex: (collection, args) => ({
			command: {
				collMod: collection,
				index: indexSelector(args[0], true)
			},
			cursor: false
		}),
		unhideIndex: (collection, args) => ({
			command: {
				collMod: collection,
				index: indexSelector(args[0], false)
			},
			cursor: false
		}),
		getSearchIndexes: (collection, args) => ({
			command: {
				aggregate: collection,
				pipeline: [{ $listSearchIndexes: compact({ name: typeof args[0] === "string" ? args[0] : void 0 }) }],
				cursor: {}
			},
			cursor: true
		}),
		createSearchIndex: (collection, args) => {
			return {
				command: {
					createSearchIndexes: collection,
					indexes: [isDoc(args[0]) && args.length === 1 ? args[0] : compact({
						name: string(args[0], "name"),
						type: args.length > 2 ? args[1] : void 0,
						definition: doc(args.at(-1), "definition")
					})]
				},
				cursor: false
			};
		},
		updateSearchIndex: (collection, args) => ({
			command: {
				updateSearchIndex: collection,
				name: string(args[0], "name"),
				definition: doc(args[1], "definition")
			},
			cursor: false
		}),
		dropSearchIndex: (collection, args) => ({
			command: {
				dropSearchIndex: collection,
				name: string(args[0], "name")
			},
			cursor: false
		}),
		drop: (collection) => ({
			command: { drop: collection },
			cursor: false,
			shape: () => true
		}),
		renameCollection: (collection, args, database) => ({
			database: "admin",
			command: {
				renameCollection: `${database}.${collection}`,
				to: `${database}.${string(args[0], "name")}`,
				dropTarget: args[1] === true
			},
			cursor: false
		}),
		stats: (collection, args) => ({
			command: {
				aggregate: collection,
				pipeline: [{ $collStats: { storageStats: doc(args[0], "options") } }],
				cursor: {}
			},
			cursor: true,
			shape: (documents) => field(first(documents), "storageStats")
		}),
		validate: (collection, args) => ({
			command: {
				validate: collection,
				...doc(args[0], "options")
			},
			cursor: false
		})
	};
	COLLECTION_METHODS.ensureIndex = COLLECTION_METHODS.createIndex;
	COLLECTION_METHODS.indexes = COLLECTION_METHODS.getIndexes;
	function indexSelector(index, hidden) {
		if (typeof index === "string") return {
			name: index,
			hidden
		};
		return {
			keyPattern: doc(index, "index"),
			hidden
		};
	}
	var DATABASE_METHODS = {
		runCommand: (args) => ({
			command: typeof args[0] === "string" ? { [args[0]]: 1 } : doc(args[0], "command"),
			cursor: false
		}),
		adminCommand: (args) => ({
			database: "admin",
			command: typeof args[0] === "string" ? { [args[0]]: 1 } : doc(args[0], "command"),
			cursor: false
		}),
		aggregate: (args) => ({
			command: {
				aggregate: 1,
				pipeline: array(args[0], "pipeline"),
				cursor: {},
				...doc(args[1], "options")
			},
			cursor: true,
			paging: "aggregate"
		}),
		getCollectionNames: () => ({
			command: {
				listCollections: 1,
				nameOnly: true
			},
			cursor: true,
			shape: (documents) => documents.map((document) => String(document.name)).sort((a, b) => a.localeCompare(b))
		}),
		getCollectionInfos: (args) => ({
			command: {
				listCollections: 1,
				filter: doc(args[0], "filter"),
				...doc(args[1], "options")
			},
			cursor: true
		}),
		createCollection: (args) => ({
			command: {
				create: string(args[0], "name"),
				...doc(args[1], "options")
			},
			cursor: false
		}),
		createView: (args) => ({
			command: {
				create: string(args[0], "name"),
				viewOn: string(args[1], "source"),
				pipeline: array(args[2], "pipeline"),
				...doc(args[3], "options")
			},
			cursor: false
		}),
		dropDatabase: () => ({
			command: { dropDatabase: 1 },
			cursor: false
		}),
		stats: (args) => ({
			command: compact({
				dbStats: 1,
				scale: isDoc(args[0]) ? args[0].scale : args[0]
			}),
			cursor: false
		}),
		version: () => ({
			command: { buildInfo: 1 },
			cursor: false,
			shape: (reply) => field(reply, "version")
		}),
		serverBuildInfo: () => ({
			command: { buildInfo: 1 },
			cursor: false
		}),
		serverStatus: (args) => ({
			command: {
				serverStatus: 1,
				...doc(args[0], "options")
			},
			cursor: false
		}),
		hostInfo: () => ({
			database: "admin",
			command: { hostInfo: 1 },
			cursor: false
		}),
		hello: () => ({
			command: { hello: 1 },
			cursor: false
		}),
		listCommands: () => ({
			command: { listCommands: 1 },
			cursor: false,
			shape: (reply) => field(reply, "commands")
		}),
		currentOp: (args) => ({
			database: "admin",
			command: {
				aggregate: 1,
				pipeline: [{ $currentOp: {} }, { $match: isDoc(args[0]) ? args[0] : {} }],
				cursor: {}
			},
			cursor: true
		}),
		killOp: (args) => ({
			database: "admin",
			command: {
				killOp: 1,
				op: number(args[0], "opid")
			},
			cursor: false
		}),
		getUsers: () => ({
			command: { usersInfo: 1 },
			cursor: false,
			shape: (reply) => field(reply, "users")
		}),
		getRoles: (args) => ({
			command: {
				rolesInfo: 1,
				...doc(args[0], "options")
			},
			cursor: false,
			shape: (reply) => field(reply, "roles")
		}),
		getProfilingStatus: () => ({
			command: { profile: -1 },
			cursor: false
		}),
		setProfilingLevel: (args) => ({
			command: {
				profile: number(args[0], "level"),
				...isDoc(args[1]) ? args[1] : compact({ slowms: args[1] })
			},
			cursor: false
		})
	};
	var collectionMethodNames = Object.keys(COLLECTION_METHODS);
	var databaseMethodNames = Object.keys(DATABASE_METHODS);
	/** Cursor methods that set a field of the `find` command. */
	var FIND_MODIFIERS = {
		sort: (args) => ({ sort: doc(args[0], "sort") }),
		limit: (args) => ({ limit: Math.abs(number(args[0], "limit")) }),
		skip: (args) => ({ skip: number(args[0], "skip") }),
		project: (args) => ({ projection: doc(args[0], "projection") }),
		projection: (args) => ({ projection: doc(args[0], "projection") }),
		hint: (args) => ({ hint: args[0] ?? {} }),
		collation: (args) => ({ collation: doc(args[0], "collation") }),
		maxTimeMS: (args) => ({ maxTimeMS: number(args[0], "maxTimeMS") }),
		batchSize: (args) => ({ batchSize: number(args[0], "batchSize") }),
		comment: (args) => ({ comment: args[0] ?? "" }),
		min: (args) => ({ min: doc(args[0], "min") }),
		max: (args) => ({ max: doc(args[0], "max") }),
		returnKey: (args) => ({ returnKey: args[0] ?? true }),
		showRecordId: (args) => ({ showRecordId: args[0] ?? true }),
		allowDiskUse: (args) => ({ allowDiskUse: args[0] ?? true }),
		readConcern: (args) => ({ readConcern: { level: string(args[0], "level") } }),
		noCursorTimeout: () => ({ noCursorTimeout: true })
	};
	var AGGREGATE_MODIFIERS = {
		hint: FIND_MODIFIERS.hint,
		collation: FIND_MODIFIERS.collation,
		maxTimeMS: FIND_MODIFIERS.maxTimeMS,
		comment: FIND_MODIFIERS.comment,
		allowDiskUse: FIND_MODIFIERS.allowDiskUse,
		batchSize: (args) => ({ cursor: { batchSize: number(args[0], "batchSize") } })
	};
	/** Methods that read the cursor in the shell; here the result is shown anyway. */
	var NO_EFFECT = [
		"toArray",
		"pretty",
		"itcount",
		"forEach",
		"next",
		"hasNext"
	];
	var findModifierNames = [
		...Object.keys(FIND_MODIFIERS),
		"count",
		"explain",
		"toArray"
	];
	var aggregateModifierNames = [
		...Object.keys(AGGREGATE_MODIFIERS),
		"explain",
		"toArray"
	];
	function explain(plan, verbosity) {
		const command = plan.command.aggregate === void 0 ? plan.command : omit(plan.command, ["cursor"]);
		return {
			database: plan.database,
			command: {
				explain: plan.command.aggregate === void 0 ? command : {
					...command,
					cursor: {}
				},
				verbosity: typeof verbosity === "string" ? verbosity : "queryPlanner"
			},
			cursor: false
		};
	}
	function applyModifier(plan, modifier) {
		if (NO_EFFECT.includes(modifier.name)) return plan;
		if (modifier.name === "explain") return explain(plan, modifier.args[0]);
		if (plan.command.find !== void 0 && plan.paging === "find") {
			if (modifier.name === "count" || modifier.name === "size") {
				const pipeline = [{ $match: plan.command.filter ?? {} }];
				if (modifier.name === "size" && plan.command.skip !== void 0) pipeline.push({ $skip: plan.command.skip });
				if (modifier.name === "size" && plan.command.limit !== void 0) pipeline.push({ $limit: plan.command.limit });
				pipeline.push({ $group: {
					_id: 1,
					n: { $sum: 1 }
				} });
				return {
					database: plan.database,
					command: compact({
						aggregate: plan.command.find,
						pipeline,
						cursor: {},
						hint: plan.command.hint,
						collation: plan.command.collation
					}),
					cursor: true,
					shape: (documents) => field(first(documents), "n") ?? 0
				};
			}
			const change = FIND_MODIFIERS[modifier.name];
			if (change) return {
				...plan,
				command: {
					...plan.command,
					...change(modifier.args)
				}
			};
		}
		if (plan.command.aggregate !== void 0 && plan.paging === "aggregate") {
			const change = AGGREGATE_MODIFIERS[modifier.name];
			if (change) return {
				...plan,
				command: {
					...plan.command,
					...change(modifier.args)
				}
			};
		}
		throw new ShellError("error.plan.modifier", { name: modifier.name });
	}
	/** The plan for a statement, with `database` as the one chosen where the statement names none. */
	function planStatement(statement, database) {
		const target = statement.database ?? database;
		if (!target) throw new ShellError("error.plan.database");
		if (statement.collection !== void 0 && statement.method === "explain" && statement.modifiers.length > 0) {
			const [method, ...modifiers] = statement.modifiers;
			return planStatement({
				...statement,
				method: method.name,
				args: method.args,
				modifiers: [...modifiers, {
					name: "explain",
					args: statement.args
				}]
			}, database);
		}
		let base;
		if (statement.collection === void 0) {
			const method = DATABASE_METHODS[statement.method];
			if (!method) throw new ShellError("error.plan.databaseMethod", { name: statement.method });
			base = method(statement.args, target);
		} else {
			if (statement.method === "bulkWrite") throw new ShellError("error.plan.bulkWrite");
			const method = COLLECTION_METHODS[statement.method];
			if (!method) throw new ShellError("error.plan.collectionMethod", { name: statement.method });
			base = method(statement.collection, statement.args, target);
		}
		return statement.modifiers.reduce(applyModifier, {
			database: target,
			...base
		});
	}
	/** A write that the server took but that did not go through (`ok: 1` with `writeErrors`). */
	function replyError(reply) {
		if (!isDoc(reply)) return void 0;
		const writeError = first(reply.writeErrors ?? null);
		if (isDoc(writeError)) return typeof writeError.errmsg === "string" ? writeError.errmsg : { key: "error.plan.write" };
		if (isDoc(reply.writeConcernError)) return typeof reply.writeConcernError.errmsg === "string" ? reply.writeConcernError.errmsg : { key: "error.plan.writeConcern" };
	}
	//#endregion
	//#region src/shell/runtime/bson.ts
	/**
	* The BSON types of a script and their way to and from extended JSON. In a script a document is a
	* plain object; values JavaScript has no type for are instances of the classes here, so they come
	* back to the server as what they were (a NumberLong stays a 64 bit integer).
	*/
	var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
	function hexToBase64(hex) {
		const bytes = hex.match(/../g)?.map((pair) => parseInt(pair, 16)) ?? [];
		let out = "";
		for (let index = 0; index < bytes.length; index += 3) {
			const [a, b, c] = [
				bytes[index],
				bytes[index + 1],
				bytes[index + 2]
			];
			out += BASE64[a >> 2] + BASE64[(a & 3) << 4 | (b ?? 0) >> 4] + (b === void 0 ? "=" : BASE64[(b & 15) << 2 | (c ?? 0) >> 6]) + (c === void 0 ? "=" : BASE64[c & 63]);
		}
		return out;
	}
	/** Marks a class whose instances know their extended JSON. */
	var BsonValue = class {};
	/** Lets a class be called without `new`, as the shell allows: `ObjectId("…")`. */
	function callable(type) {
		return new Proxy(type, { apply: (target, _, args) => new target(...args) });
	}
	var ObjectId = callable(class ObjectId extends BsonValue {
		str;
		constructor(hex) {
			super();
			if (hex !== void 0 && !/^[0-9a-f]{24}$/i.test(hex)) throw new Error("An ObjectId has 24 hexadecimal digits");
			this.str = (hex ?? String(newObjectId().$oid)).toLowerCase();
		}
		getTimestamp() {
			return /* @__PURE__ */ new Date(parseInt(this.str.slice(0, 8), 16) * 1e3);
		}
		equals(other) {
			return other instanceof ObjectId && other.str === this.str;
		}
		valueOf() {
			return this.str;
		}
		toEjson() {
			return { $oid: this.str };
		}
		toString() {
			return `ObjectId("${this.str}")`;
		}
	});
	/** A number with a fixed BSON type; `valueOf` lets scripts calculate with it. */
	function numeric(key, shell, quoted) {
		return callable(class extends BsonValue {
			value;
			constructor(value = 0) {
				super();
				this.value = String(value);
			}
			valueOf() {
				return Number(this.value);
			}
			/**
			* In arithmetic a number. Where JavaScript may choose (`"n: " + value`) also a number if that
			* loses nothing, else the exact digits: a 64 bit id is not printed rounded.
			*/
			[Symbol.toPrimitive](hint) {
				const number = Number(this.value);
				return hint === "number" || hint === "default" && String(number) === this.value ? number : this.value;
			}
			toNumber() {
				return Number(this.value);
			}
			toEjson() {
				return { [key]: this.value };
			}
			toString() {
				return quoted ? `${shell}("${this.value}")` : `${shell}(${this.value})`;
			}
		});
	}
	var NumberLong = numeric("$numberLong", "NumberLong", false);
	var NumberInt = numeric("$numberInt", "NumberInt", false);
	var NumberDecimal = numeric("$numberDecimal", "NumberDecimal", true);
	var BinData = callable(class BinData extends BsonValue {
		subType;
		base64;
		constructor(subType, base64) {
			super();
			this.subType = subType;
			this.base64 = base64;
		}
		toEjson() {
			return { $binary: {
				base64: this.base64,
				subType: this.subType.toString(16).padStart(2, "0")
			} };
		}
		toString() {
			return `BinData(${this.subType}, "${this.base64}")`;
		}
	});
	var Timestamp = callable(class Timestamp extends BsonValue {
		t;
		i;
		constructor(t = 0, i = 0) {
			super();
			this.t = t;
			this.i = i;
		}
		toEjson() {
			return { $timestamp: {
				t: this.t,
				i: this.i
			} };
		}
		toString() {
			return `Timestamp(${this.t}, ${this.i})`;
		}
	});
	function key(name, shell) {
		return callable(class extends BsonValue {
			toEjson() {
				return { [name]: 1 };
			}
			toString() {
				return `${shell}()`;
			}
		});
	}
	var MinKey = key("$minKey", "MinKey");
	var MaxKey = key("$maxKey", "MaxKey");
	/** `UUID("…")`: binary of subtype 4. */
	function uuid(text) {
		const hex = (text ?? "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (char) => Math.floor(Math.random() * (char === "x" ? 16 : 4) + (char === "x" ? 0 : 8)).toString(16))).replaceAll("-", "");
		if (!/^[0-9a-f]{32}$/i.test(hex)) throw new Error(`"${text}" is not a UUID`);
		return new BinData(4, hexToBase64(hex));
	}
	/** `ISODate("2024-05-01")`: a date without a zone is UTC, as in the shell. */
	function isoDate(text) {
		if (text === void 0) return /* @__PURE__ */ new Date();
		const iso = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/.test(text) ? `${text.replace(" ", "T")}${text.length > 10 ? "" : "T00:00:00"}Z` : text;
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) throw new Error(`"${text}" is not a date`);
		return date;
	}
	/** A value of a script as extended JSON, to send it to the server. */
	function toEjson(value) {
		if (value === null || value === void 0) return null;
		if (typeof value === "string" || typeof value === "boolean") return value;
		if (typeof value === "number") return Number.isFinite(value) ? value : { $numberDouble: String(value) };
		if (typeof value === "bigint") return { $numberLong: value.toString() };
		if (typeof value === "function") return { $code: String(value) };
		if (value instanceof BsonValue) return value.toEjson();
		if (value instanceof Date) return { $date: { $numberLong: String(value.getTime()) } };
		if (value instanceof RegExp) return { $regularExpression: {
			pattern: value.source,
			options: value.flags
		} };
		if (Array.isArray(value)) return value.map(toEjson);
		return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== void 0).map(([name, item]) => [name, toEjson(item)]));
	}
	function wrapped(value) {
		const keys = Object.keys(value);
		const first = keys[0];
		if (first === void 0 || !first.startsWith("$") || keys.length > 2) return void 0;
		const inner = value[first];
		const part = (name) => inner[name];
		switch (first) {
			case "$oid": return new ObjectId(String(inner));
			case "$date": return new Date(Number(typeof inner === "object" && inner !== null ? inner.$numberLong : inner));
			case "$numberInt":
			case "$numberDouble": return Number(inner);
			case "$numberLong": return new NumberLong(String(inner));
			case "$numberDecimal": return new NumberDecimal(String(inner));
			case "$regularExpression": return new RegExp(String(part("pattern")), String(part("options") ?? "").replace(/[^dgimsuvy]/g, ""));
			case "$binary": return new BinData(parseInt(String(part("subType")), 16), String(part("base64")));
			case "$timestamp": return new Timestamp(Number(part("t")), Number(part("i")));
			case "$minKey": return new MinKey();
			case "$maxKey": return new MaxKey();
			case "$undefined": return null;
			default: return;
		}
	}
	/** A value from the server (canonical extended JSON) as a script works with it. */
	function fromEjson(value) {
		if (value === null || typeof value !== "object") return value;
		if (Array.isArray(value)) return value.map(fromEjson);
		const special = wrapped(value);
		if (special !== void 0) return special;
		return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, fromEjson(item)]));
	}
	//#endregion
	//#region src/shell/runtime/index.ts
	/**
	* What a script sees: `db`, the BSON helpers, `print`. This file is bundled into
	* `src-tauri/script/runtime.js` (`bun run build:runtime`) and runs inside the JavaScript engine of
	* the Rust side, not in the web view. Database access goes through the same planning as a single
	* statement (`../plan.ts`), so both ways build the same commands.
	*/
	/** Documents fetched from an open cursor at a time. */
	var BATCH = 200;
	/** Documents of a cursor shown when it is the result of the script. */
	var SHOWN = 1e3;
	var currentDatabase = "";
	function fail(message) {
		throw new Error(typeof message === "string" ? message : message.key);
	}
	function runCommand(database, command) {
		const reply = JSON.parse(__command(database, JSON.stringify(command)));
		const failure = replyError(reply);
		if (failure) fail(failure);
		return reply;
	}
	/** A cursor as the shell knows it: set up with `sort`, `limit` …, read with `forEach`, `toArray` … */
	var Cursor = class {
		database;
		collection;
		method;
		args;
		modifiers = [];
		handle;
		buffer = [];
		finished = false;
		constructor(database, collection, method, args, modifiers = []) {
			this.database = database;
			this.collection = collection;
			this.method = method;
			this.args = args;
			this.modifiers.push(...modifiers);
			for (const name of /* @__PURE__ */ new Set([...findModifierNames, ...aggregateModifierNames])) {
				if (name in this) continue;
				Object.defineProperty(this, name, { value: (...values) => {
					if (this.handle !== void 0) fail(`.${name}() comes too late: the cursor was already read`);
					this.modifiers.push({
						name,
						args: values.map(toEjson)
					});
					return this;
				} });
			}
		}
		plan(extra = []) {
			return planStatement({
				collection: this.collection,
				method: this.method,
				args: this.args,
				modifiers: [...this.modifiers, ...extra],
				start: 0,
				end: 0
			}, this.database);
		}
		fill() {
			if (this.finished || this.buffer.length > 0) return;
			if (this.handle === void 0) {
				const plan = this.plan();
				this.handle = __cursorOpen(plan.database, JSON.stringify(plan.command));
			}
			this.buffer = JSON.parse(__cursorNext(this.handle, BATCH));
			if (this.buffer.length === 0) this.finished = true;
		}
		hasNext() {
			this.fill();
			return this.buffer.length > 0;
		}
		next() {
			if (!this.hasNext()) fail("The cursor has no more documents");
			return fromEjson(this.buffer.shift());
		}
		forEach(callback) {
			while (this.hasNext()) callback(this.next());
		}
		map(callback) {
			const mapped = [];
			this.forEach((document) => mapped.push(callback(document)));
			return mapped;
		}
		toArray() {
			return this.map((document) => document);
		}
		itcount() {
			let count = 0;
			this.forEach(() => count++);
			return count;
		}
		/** What the server says the query matches, without reading the documents. */
		count() {
			return execute(this.plan([{
				name: "count",
				args: []
			}]));
		}
		size() {
			return execute(this.plan([{
				name: "size",
				args: []
			}]));
		}
		explain(verbosity) {
			return execute(this.plan([{
				name: "explain",
				args: verbosity === void 0 ? [] : [verbosity]
			}]));
		}
		close() {
			if (this.handle !== void 0 && !this.finished) __cursorClose(this.handle);
			this.finished = true;
			this.buffer = [];
		}
		pretty() {
			return this;
		}
		[Symbol.iterator]() {
			return { next: () => this.hasNext() ? {
				value: this.next(),
				done: false
			} : {
				value: void 0,
				done: true
			} };
		}
		/** The call behind a cursor nobody has read yet: the window runs it itself and can page it. */
		unread() {
			if (this.handle !== void 0) return void 0;
			return {
				database: this.database,
				collection: this.collection,
				method: this.method,
				args: this.args,
				modifiers: this.modifiers
			};
		}
		/** For the result of a script: the first documents as extended JSON, and whether there were more. */
		preview() {
			const items = [];
			while (items.length < SHOWN && this.hasNext()) items.push(this.buffer.shift());
			const truncated = this.hasNext();
			this.close();
			return {
				items,
				truncated
			};
		}
	};
	/** Runs a plan to its end and gives back what the shell would show, as script values. */
	function execute(plan) {
		let result;
		if (plan.cursor) {
			const handle = __cursorOpen(plan.database, JSON.stringify(plan.command));
			const documents = [];
			for (;;) {
				const batch = JSON.parse(__cursorNext(handle, BATCH));
				if (batch.length === 0) break;
				documents.push(...batch);
			}
			result = plan.shape ? plan.shape(documents) : documents;
		} else {
			const reply = runCommand(plan.database, plan.command);
			result = plan.shape ? plan.shape(reply) : reply;
		}
		return fromEjson(result);
	}
	function call(database, collection, method, values, modifiers = []) {
		const args = values.map(toEjson);
		if ((method === "find" && collection !== void 0 || method === "aggregate") && modifiers.length === 0) return new Cursor(database, collection, method, args);
		return execute(planStatement({
			collection,
			method,
			args,
			modifiers,
			start: 0,
			end: 0
		}, database));
	}
	/** Options of a bulk operation that belong to the single write. */
	var WRITE_OPTIONS = [
		"upsert",
		"arrayFilters",
		"collation",
		"hint"
	];
	/**
	* `bulkWrite`: the operations one after the other, counted together as drivers report them.
	* With `ordered: false` a failing operation is noted and the rest still runs.
	*/
	function bulkWrite(database, collection, operations, options = {}) {
		if (!Array.isArray(operations)) fail("bulkWrite takes an array of operations");
		const result = {
			acknowledged: true,
			insertedCount: 0,
			matchedCount: 0,
			modifiedCount: 0,
			deletedCount: 0,
			upsertedCount: 0,
			insertedIds: {},
			upsertedIds: {}
		};
		const errors = [];
		operations.forEach((operation, index) => {
			const [kind] = Object.keys(operation);
			const detail = kind === void 0 ? void 0 : operation[kind];
			if (kind === void 0 || detail === void 0) fail(`Operation ${index} of bulkWrite is empty`);
			const pick = Object.fromEntries(WRITE_OPTIONS.filter((name) => detail[name] !== void 0).map((name) => [name, detail[name]]));
			try {
				switch (kind) {
					case "insertOne": {
						const done = call(database, collection, "insertOne", [detail.document]);
						result.insertedCount++;
						result.insertedIds[index] = done.insertedId;
						break;
					}
					case "updateOne":
					case "updateMany":
					case "replaceOne": {
						const done = call(database, collection, kind, [
							detail.filter,
							kind === "replaceOne" ? detail.replacement : detail.update,
							pick
						]);
						result.matchedCount += Number(done.matchedCount);
						result.modifiedCount += Number(done.modifiedCount);
						if (done.upsertedCount) {
							result.upsertedCount++;
							result.upsertedIds[index] = done.upsertedId;
						}
						break;
					}
					case "deleteOne":
					case "deleteMany":
						result.deletedCount += Number(call(database, collection, kind, [detail.filter, pick]).deletedCount);
						break;
					default: fail(`bulkWrite does not know the operation ${kind}`);
				}
			} catch (error) {
				if (options.ordered !== false) throw error;
				errors.push({
					index,
					errmsg: String(error.message)
				});
			}
		});
		return errors.length > 0 ? {
			...result,
			writeErrors: errors
		} : result;
	}
	function collectionOf(database, name) {
		return new Proxy({}, { get(_, property) {
			if (typeof property !== "string") return void 0;
			if (property === "getName") return () => name;
			if (property === "getFullName") return () => `${database}.${name}`;
			if (property === "explain") return (verbosity) => new Proxy({}, { get: (__, method) => typeof method === "string" ? (...values) => call(database, name, method, values, [{
				name: "explain",
				args: verbosity === void 0 ? [] : [verbosity]
			}]) : void 0 });
			if (property === "bulkWrite") return (operations, options) => bulkWrite(database, name, operations, options);
			if (collectionMethodNames.includes(property)) return (...values) => call(database, name, property, values);
			return collectionOf(database, `${name}.${property}`);
		} });
	}
	function databaseOf(database) {
		return new Proxy({}, { get(_, property) {
			if (typeof property !== "string") return void 0;
			if (property === "getName") return () => database;
			if (property === "getCollection") return (name) => collectionOf(database, name);
			if (property === "getSiblingDB") return (name) => databaseOf(name);
			if (databaseMethodNames.includes(property)) return (...values) => call(database, void 0, property, values);
			return collectionOf(database, property);
		} });
	}
	function text(value) {
		return typeof value === "string" ? value : toShell(toEjson(value));
	}
	Object.assign(globalThis, {
		ObjectId,
		ObjectID: ObjectId,
		ISODate: isoDate,
		NumberLong,
		Long: NumberLong,
		NumberInt,
		Int32: NumberInt,
		NumberDecimal,
		Decimal128: NumberDecimal,
		UUID: uuid,
		BinData,
		Timestamp,
		MinKey,
		MaxKey,
		print: (...values) => __print(values.map(text).join(" ")),
		printjson: (value) => __print(toShell(toEjson(value))),
		tojson: (value) => toShell(toEjson(value)),
		console: {
			log: (...values) => __print(values.map(text).join(" ")),
			error: (...values) => __print(values.map(text).join(" ")),
			warn: (...values) => __print(values.map(text).join(" "))
		}
	});
	/** Called by the Rust side around a script. */
	Object.assign(globalThis, { __qm: {
		/** Before the script: `db` is the database of the tab. */
		setup(database) {
			currentDatabase = database;
			Object.assign(globalThis, { db: databaseOf(currentDatabase) });
		},
		/** After the script: its last value as what the result view shows. */
		finish(value) {
			if (value instanceof Cursor) {
				const cursor = value.unread();
				return JSON.stringify(cursor ? {
					items: [],
					truncated: false,
					cursor
				} : value.preview());
			}
			if (value === void 0) return JSON.stringify({
				items: [],
				truncated: false
			});
			const json = toEjson(value);
			const items = Array.isArray(json) ? json : [json];
			return JSON.stringify({
				items: items.slice(0, SHOWN),
				truncated: items.length > SHOWN
			});
		}
	} });
	if (!("crypto" in globalThis)) Object.assign(globalThis, { crypto: { getRandomValues(bytes) {
		for (let index = 0; index < bytes.length; index++) bytes[index] = Math.floor(Math.random() * 256);
		return bytes;
	} } });
	//#endregion
	exports.isDoc = isDoc;
	exports.newObjectId = newObjectId;
	return exports;
})({});
