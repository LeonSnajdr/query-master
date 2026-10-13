/**
 * What the editor suggests: methods, stages and operators, with the server version that brought
 * them. Entries newer than the connected server are still offered, marked as such. Their
 * descriptions are messages (`doc.<group>.<name>` in `i18n/locales`).
 */
export type Group = "collection" | "database" | "cursor" | "stage" | "query" | "update" | "accumulator" | "window"
    | "expression" | "projection" | "variable" | "helper";

export interface Entry {
    name: string;
    group: Group;
    /** First server version that knows it, as `major.minor`. */
    since?: string;
    /** Still works, but these took its place. */
    replacedBy?: string[];
    /** Inserted instead of the name; `${…}` marks a place to fill in. */
    snippet?: string;
    /** Keys of the document it takes. */
    keys?: string[];
}

/** The message that describes an entry. */
export function docKey(entry: Pick<Entry, "group" | "name">): string {
    return `doc.${entry.group}.${entry.name.replaceAll("$", "")}`;
}

function entries(group: Group, since: string | undefined, names: string[]): Entry[] {
    return names.map(name => ({ name, group, since }));
}

/** `[name, snippet, since]` rows of one group. */
function snippets(group: Group, rows: [name: string, snippet: string, since?: string][]): Entry[] {
    return rows.map(([name, snippet, since]) => ({ name, group, snippet, since }));
}

function replaced(group: Group, rows: [name: string, snippet: string, replacedBy: string[]][]): Entry[] {
    return rows.map(([name, snippet, replacedBy]) => ({ name, group, snippet, replacedBy }));
}

export const COLLECTION_METHODS: Entry[] = [
    ...snippets("collection", [
        ["find", "find({ ${} })"],
        ["findOne", "findOne({ ${} })"],
        ["aggregate", "aggregate([\n\t{ ${} }\n])"],
        ["countDocuments", "countDocuments({ ${} })"],
        ["estimatedDocumentCount", "estimatedDocumentCount()"],
        ["distinct", "distinct(\"${field}\", { ${} })"],
        ["insertOne", "insertOne({ ${} })"],
        ["insertMany", "insertMany([\n\t{ ${} }\n])"],
        ["updateOne", "updateOne({ ${} }, { $set: { ${} } })"],
        ["updateMany", "updateMany({ ${} }, { $set: { ${} } })"],
        ["replaceOne", "replaceOne({ ${} }, { ${} })"],
        ["deleteOne", "deleteOne({ ${} })"],
        ["deleteMany", "deleteMany({ ${} })"],
        ["findOneAndUpdate", "findOneAndUpdate({ ${} }, { $set: { ${} } }, { returnDocument: \"after\" })"],
        ["findOneAndReplace", "findOneAndReplace({ ${} }, { ${} })"],
        ["findOneAndDelete", "findOneAndDelete({ ${} })"],
        ["createIndex", "createIndex({ ${field}: 1 })"],
        ["createIndexes", "createIndexes([{ ${field}: 1 }])"],
        ["getIndexes", "getIndexes()"],
        ["dropIndex", "dropIndex(\"${name}\")"],
        ["dropIndexes", "dropIndexes()"],
        ["hideIndex", "hideIndex(\"${name}\")", "4.4"],
        ["unhideIndex", "unhideIndex(\"${name}\")", "4.4"],
        ["getSearchIndexes", "getSearchIndexes()", "7.0"],
        ["createSearchIndex", "createSearchIndex(\"${name}\", { mappings: { dynamic: true } })", "7.0"],
        ["updateSearchIndex", "updateSearchIndex(\"${name}\", { ${} })", "7.0"],
        ["dropSearchIndex", "dropSearchIndex(\"${name}\")", "7.0"],
        ["explain", "explain(\"executionStats\")"],
        ["stats", "stats()"],
        ["validate", "validate()"],
        ["renameCollection", "renameCollection(\"${name}\")"],
        ["drop", "drop()"]
    ]),
    ...replaced("collection", [
        ["count", "count({ ${} })", ["countDocuments", "estimatedDocumentCount"]],
        ["insert", "insert({ ${} })", ["insertOne", "insertMany"]],
        ["update", "update({ ${} }, { $set: { ${} } })", ["updateOne", "updateMany", "replaceOne"]],
        ["remove", "remove({ ${} })", ["deleteOne", "deleteMany"]],
        ["findAndModify", "findAndModify({ query: { ${} }, update: { ${} } })", ["findOneAndUpdate", "findOneAndReplace", "findOneAndDelete"]],
        ["ensureIndex", "ensureIndex({ ${field}: 1 })", ["createIndex"]]
    ])
];

export const DATABASE_METHODS: Entry[] = snippets("database", [
    ["getCollection", "getCollection(\"${name}\")"],
    ["getSiblingDB", "getSiblingDB(\"${name}\")"],
    ["runCommand", "runCommand({ ${} })"],
    ["adminCommand", "adminCommand({ ${} })"],
    ["aggregate", "aggregate([\n\t{ ${} }\n])"],
    ["getCollectionNames", "getCollectionNames()"],
    ["getCollectionInfos", "getCollectionInfos()"],
    ["createCollection", "createCollection(\"${name}\")"],
    ["createView", "createView(\"${name}\", \"${source}\", [${}])"],
    ["dropDatabase", "dropDatabase()"],
    ["stats", "stats()"],
    ["version", "version()"],
    ["serverStatus", "serverStatus()"],
    ["serverBuildInfo", "serverBuildInfo()"],
    ["hostInfo", "hostInfo()"],
    ["hello", "hello()", "5.0"],
    ["currentOp", "currentOp()"],
    ["killOp", "killOp(${opid})"],
    ["getUsers", "getUsers()"],
    ["getRoles", "getRoles()"],
    ["getProfilingStatus", "getProfilingStatus()"],
    ["setProfilingLevel", "setProfilingLevel(${1})"],
    ["listCommands", "listCommands()"]
]);

export const FIND_MODIFIERS: Entry[] = snippets("cursor", [
    ["sort", "sort({ ${field}: 1 })"],
    ["limit", "limit(${10})"],
    ["skip", "skip(${10})"],
    ["project", "project({ ${} })"],
    ["hint", "hint(${})"],
    ["collation", "collation({ locale: \"${en}\" })"],
    ["count", "count()"],
    ["explain", "explain(\"executionStats\")"],
    ["maxTimeMS", "maxTimeMS(${1000})"],
    ["allowDiskUse", "allowDiskUse()", "4.4"],
    ["comment", "comment(\"${}\")"],
    ["min", "min({ ${} })"],
    ["max", "max({ ${} })"],
    ["returnKey", "returnKey()"],
    ["showRecordId", "showRecordId()"],
    ["readConcern", "readConcern(\"${majority}\")"],
    ["toArray", "toArray()"]
]);

export const AGGREGATE_MODIFIERS: Entry[] = snippets("cursor", [
    ["explain", "explain(\"executionStats\")"],
    ["hint", "hint(${})"],
    ["collation", "collation({ locale: \"${en}\" })"],
    ["maxTimeMS", "maxTimeMS(${1000})"],
    ["allowDiskUse", "allowDiskUse()"],
    ["comment", "comment(\"${}\")"],
    ["toArray", "toArray()"]
]);

function stage(name: string, snippet: string, extra: { since?: string; keys?: string[] } = {}): Entry {
    return { name, group: "stage", snippet, ...extra };
}

export const STAGES: Entry[] = [
    stage("$match", "$match: { ${} }"),
    stage("$project", "$project: { ${} }"),
    stage("$group", "$group: {\n\t_id: ${\"$field\"},\n\t${count}: { $sum: 1 }\n}"),
    stage("$sort", "$sort: { ${field}: 1 }"),
    stage("$limit", "$limit: ${10}"),
    stage("$skip", "$skip: ${10}"),
    stage("$unwind", "$unwind: \"$${field}\"", { keys: ["path", "includeArrayIndex", "preserveNullAndEmptyArrays"] }),
    stage("$lookup", "$lookup: {\n\tfrom: \"${collection}\",\n\tlocalField: \"${field}\",\n\tforeignField: \"${_id}\",\n\tas: \"${result}\"\n}", {
        keys: ["from", "localField", "foreignField", "let", "pipeline", "as"]
    }),
    stage("$addFields", "$addFields: { ${} }"),
    stage("$set", "$set: { ${} }", { since: "4.2" }),
    stage("$unset", "$unset: \"${field}\"", { since: "4.2" }),
    stage("$count", "$count: \"${count}\""),
    stage("$replaceRoot", "$replaceRoot: { newRoot: \"$${field}\" }", { keys: ["newRoot"] }),
    stage("$replaceWith", "$replaceWith: \"$${field}\"", { since: "4.2" }),
    stage("$facet", "$facet: {\n\t${name}: [${}]\n}"),
    stage("$bucket", "$bucket: {\n\tgroupBy: \"$${field}\",\n\tboundaries: [${0, 10, 100}],\n\tdefault: \"${other}\"\n}", {
        keys: ["groupBy", "boundaries", "default", "output"]
    }),
    stage("$bucketAuto", "$bucketAuto: { groupBy: \"$${field}\", buckets: ${5} }", { keys: ["groupBy", "buckets", "output", "granularity"] }),
    stage("$sortByCount", "$sortByCount: \"$${field}\""),
    stage("$sample", "$sample: { size: ${10} }", { keys: ["size"] }),
    stage("$unionWith", "$unionWith: { coll: \"${collection}\", pipeline: [${}] }", { since: "4.4", keys: ["coll", "pipeline"] }),
    stage("$graphLookup", "$graphLookup: {\n\tfrom: \"${collection}\",\n\tstartWith: \"$${field}\",\n\tconnectFromField: \"${field}\",\n\tconnectToField: \"${_id}\",\n\tas: \"${result}\"\n}", {
        keys: ["from", "startWith", "connectFromField", "connectToField", "as", "maxDepth", "depthField", "restrictSearchWithMatch"]
    }),
    stage("$geoNear", "$geoNear: {\n\tnear: { type: \"Point\", coordinates: [${0, 0}] },\n\tdistanceField: \"${distance}\"\n}", {
        keys: ["near", "distanceField", "spherical", "maxDistance", "minDistance", "query", "distanceMultiplier", "includeLocs", "key"]
    }),
    stage("$out", "$out: \"${collection}\"", { keys: ["db", "coll", "timeseries"] }),
    stage("$merge", "$merge: {\n\tinto: \"${collection}\",\n\ton: \"${_id}\",\n\twhenMatched: \"${merge}\",\n\twhenNotMatched: \"${insert}\"\n}", {
        since: "4.2",
        keys: ["into", "on", "let", "whenMatched", "whenNotMatched"]
    }),
    stage("$redact", "$redact: { ${} }"),
    stage("$collStats", "$collStats: { storageStats: {} }", { keys: ["latencyStats", "storageStats", "count", "queryExecStats"] }),
    stage("$indexStats", "$indexStats: {}"),
    stage("$planCacheStats", "$planCacheStats: {}", { since: "4.2" }),
    stage("$currentOp", "$currentOp: {}", { keys: ["allUsers", "idleConnections", "idleCursors", "idleSessions", "localOps"] }),
    stage("$listSessions", "$listSessions: {}"),
    stage("$listLocalSessions", "$listLocalSessions: {}"),
    stage("$changeStream", "$changeStream: {}", {
        keys: ["fullDocument", "fullDocumentBeforeChange", "resumeAfter", "startAfter", "startAtOperationTime", "showExpandedEvents", "allChangesForCluster"]
    }),
    stage("$setWindowFields", "$setWindowFields: {\n\tpartitionBy: \"$${field}\",\n\tsortBy: { ${field}: 1 },\n\toutput: {\n\t\t${name}: { $sum: \"$${field}\", window: { documents: [\"unbounded\", \"current\"] } }\n\t}\n}", {
        since: "5.0",
        keys: ["partitionBy", "sortBy", "output"]
    }),
    stage("$documents", "$documents: [\n\t{ ${} }\n]", { since: "5.1" }),
    stage("$densify", "$densify: {\n\tfield: \"${field}\",\n\trange: { step: ${1}, unit: \"${day}\", bounds: \"${full}\" }\n}", {
        since: "5.1",
        keys: ["field", "partitionByFields", "range"]
    }),
    stage("$fill", "$fill: {\n\tsortBy: { ${field}: 1 },\n\toutput: { ${field}: { method: \"${locf}\" } }\n}", {
        since: "5.3",
        keys: ["partitionBy", "partitionByFields", "sortBy", "output"]
    }),
    stage("$search", "$search: {\n\tindex: \"${default}\",\n\ttext: { query: \"${}\", path: \"${field}\" }\n}", {
        since: "4.2",
        keys: ["index", "text", "compound", "autocomplete", "phrase", "wildcard", "regex", "range", "near", "equals", "exists", "in", "moreLikeThis", "queryString", "embeddedDocument", "geoWithin", "geoShape", "facet", "highlight", "count", "sort", "searchAfter", "searchBefore", "scoreDetails", "returnStoredSource", "tracking", "concurrent"]
    }),
    stage("$searchMeta", "$searchMeta: {\n\tindex: \"${default}\",\n\tfacet: { ${} }\n}", {
        since: "4.4",
        keys: ["index", "facet", "count", "text", "compound", "range", "exists"]
    }),
    stage("$vectorSearch", "$vectorSearch: {\n\tindex: \"${vector_index}\",\n\tpath: \"${embedding}\",\n\tqueryVector: [${}],\n\tnumCandidates: ${100},\n\tlimit: ${10}\n}", {
        since: "6.0",
        keys: ["index", "path", "queryVector", "numCandidates", "limit", "filter", "exact"]
    }),
    stage("$listSearchIndexes", "$listSearchIndexes: {}", { since: "7.0", keys: ["id", "name"] }),
    stage("$shardedDataDistribution", "$shardedDataDistribution: {}", { since: "6.0" }),
    stage("$changeStreamSplitLargeEvent", "$changeStreamSplitLargeEvent: {}", { since: "7.0" }),
    stage("$listSampledQueries", "$listSampledQueries: {}", { since: "7.0", keys: ["namespace"] }),
    stage("$queryStats", "$queryStats: {}", { since: "7.1", keys: ["transformIdentifiers"] }),
    stage("$querySettings", "$querySettings: {}", { since: "8.0", keys: ["showDebugQueryShape"] }),
    stage("$rankFusion", "$rankFusion: {\n\tinput: {\n\t\tpipelines: {\n\t\t\t${first}: [${}],\n\t\t\t${second}: [${}]\n\t\t}\n\t}\n}", {
        since: "8.1",
        keys: ["input", "combination", "scoreDetails"]
    }),
    stage("$scoreFusion", "$scoreFusion: {\n\tinput: {\n\t\tpipelines: {\n\t\t\t${first}: [${}],\n\t\t\t${second}: [${}]\n\t\t},\n\t\tnormalization: \"${sigmoid}\"\n\t}\n}", {
        since: "8.2",
        keys: ["input", "combination", "scoreDetails"]
    })
];

/** Stages an update written as a pipeline may hold. */
export const UPDATE_PIPELINE_STAGES = ["$addFields", "$set", "$project", "$unset", "$replaceRoot", "$replaceWith"];

/** At the top of a filter. */
export const QUERY_LOGICAL: Entry[] = entries("query", undefined, ["$and", "$or", "$nor", "$expr", "$text", "$where", "$jsonSchema", "$comment"]);

/** Under a field of a filter. */
export const QUERY_FIELD: Entry[] = entries("query", undefined, [
    "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin", "$exists", "$type", "$regex", "$options", "$not", "$elemMatch", "$all",
    "$size", "$mod", "$geoWithin", "$geoIntersects", "$near", "$nearSphere", "$bitsAllSet", "$bitsAnySet", "$bitsAllClear", "$bitsAnyClear"
]);

export const UPDATE_OPERATORS: Entry[] = entries("update", undefined, [
    "$set", "$unset", "$inc", "$mul", "$min", "$max", "$rename", "$setOnInsert", "$currentDate", "$push", "$addToSet", "$pull", "$pullAll",
    "$pop", "$bit"
]);

/** Inside `$push` and `$addToSet`. */
export const UPDATE_MODIFIERS: Entry[] = entries("update", undefined, ["$each", "$position", "$slice", "$sort"]);

export const ACCUMULATORS: Entry[] = [
    ...entries("accumulator", undefined, ["$sum", "$avg", "$min", "$max", "$first", "$last", "$push", "$addToSet", "$stdDevPop", "$stdDevSamp", "$mergeObjects"]),
    ...entries("accumulator", "4.4", ["$accumulator"]),
    ...entries("accumulator", "5.0", ["$count"]),
    ...entries("accumulator", "5.2", ["$top", "$topN", "$bottom", "$bottomN", "$firstN", "$lastN", "$maxN", "$minN"]),
    ...entries("accumulator", "7.0", ["$median", "$percentile"]),
    ...entries("accumulator", "8.1", ["$concatArrays", "$setUnion"])
];

/** Only in `$setWindowFields.output`. */
export const WINDOW_OPERATORS: Entry[] = [
    ...entries("window", "5.0", ["$rank", "$denseRank", "$documentNumber", "$shift", "$derivative", "$integral", "$covariancePop", "$covarianceSamp", "$expMovingAvg"]),
    ...entries("window", "5.3", ["$locf", "$linearFill"]),
    ...entries("window", "8.0", ["$minMaxScaler"])
];

export const EXPRESSIONS: Entry[] = [
    ...entries("expression", undefined, [
        "$abs", "$add", "$ceil", "$divide", "$exp", "$floor", "$ln", "$log", "$log10", "$mod", "$multiply", "$pow", "$sqrt", "$subtract",
        "$trunc", "$round", "$arrayElemAt", "$arrayToObject", "$concatArrays", "$filter", "$in", "$indexOfArray", "$isArray", "$map",
        "$objectToArray", "$range", "$reduce", "$reverseArray", "$size", "$slice", "$zip", "$and", "$or", "$not", "$cmp", "$eq", "$ne",
        "$gt", "$gte", "$lt", "$lte", "$cond", "$ifNull", "$switch", "$literal", "$mergeObjects", "$let", "$meta", "$type", "$concat",
        "$indexOfBytes", "$indexOfCP", "$split", "$strLenBytes", "$strLenCP", "$strcasecmp", "$substrBytes", "$substrCP", "$toLower",
        "$toUpper", "$trim", "$ltrim", "$rtrim", "$dateFromParts", "$dateFromString", "$dateToParts", "$dateToString", "$dayOfMonth",
        "$dayOfWeek", "$dayOfYear", "$hour", "$isoDayOfWeek", "$isoWeek", "$isoWeekYear", "$millisecond", "$minute", "$month", "$second",
        "$week", "$year", "$convert", "$toBool", "$toDate", "$toDecimal", "$toDouble", "$toInt", "$toLong", "$toObjectId", "$toString",
        "$setDifference", "$setEquals", "$setIntersection", "$setIsSubset", "$setUnion", "$allElementsTrue", "$anyElementTrue", "$sum",
        "$avg", "$min", "$max", "$stdDevPop", "$stdDevSamp"
    ]),
    ...entries("expression", "4.2", [
        "$regexFind", "$regexFindAll", "$regexMatch", "$sin", "$cos", "$tan", "$asin", "$acos", "$atan", "$atan2", "$asinh", "$acosh",
        "$atanh", "$degreesToRadians", "$radiansToDegrees"
    ]),
    ...entries("expression", "4.4", [
        "$first", "$last", "$function", "$isNumber", "$replaceOne", "$replaceAll", "$binarySize", "$bsonSize", "$rand", "$sinh", "$cosh",
        "$tanh"
    ]),
    ...entries("expression", "5.0", ["$dateAdd", "$dateSubtract", "$dateDiff", "$dateTrunc", "$getField", "$setField", "$unsetField", "$sampleRate"]),
    ...entries("expression", "5.1", ["$tsSecond", "$tsIncrement"]),
    ...entries("expression", "5.2", ["$sortArray", "$firstN", "$lastN", "$maxN", "$minN"]),
    ...entries("expression", "6.3", ["$bitAnd", "$bitOr", "$bitXor", "$bitNot"]),
    ...entries("expression", "7.0", ["$median", "$percentile"]),
    ...entries("expression", "8.0", ["$toUUID", "$toHashedIndexKey"])
];

/** Under a field of a projection. */
export const PROJECTION_OPERATORS: Entry[] = entries("projection", undefined, ["$slice", "$elemMatch", "$meta"]);

export const SYSTEM_VARIABLES: Entry[] = [
    ...entries("variable", undefined, ["$$ROOT", "$$CURRENT", "$$REMOVE", "$$DESCEND", "$$PRUNE", "$$KEEP"]),
    ...entries("variable", "4.2", ["$$NOW", "$$CLUSTER_TIME"]),
    ...entries("variable", "5.0", ["$$SEARCH_META"]),
    ...entries("variable", "7.0", ["$$USER_ROLES"])
];

export const BSON_HELPERS: Entry[] = [
    ...snippets("helper", [
        ["ObjectId", "ObjectId(\"${}\")"],
        ["ISODate", "ISODate(\"${2025-01-01T00:00:00Z}\")"],
        ["NumberLong", "NumberLong(${0})"],
        ["NumberInt", "NumberInt(${0})"],
        ["NumberDecimal", "NumberDecimal(\"${0}\")"],
        ["UUID", "UUID(\"${}\")"],
        ["BinData", "BinData(${0}, \"${}\")"],
        ["Timestamp", "Timestamp(${0}, ${0})"],
        ["MinKey", "MinKey()"],
        ["MaxKey", "MaxKey()"]
    ]),
    ...entries("helper", undefined, ["true", "false", "null"])
];

/** Every entry, to check that each has its description. */
export const ALL_ENTRIES: Entry[] = [
    ...COLLECTION_METHODS, ...DATABASE_METHODS, ...FIND_MODIFIERS, ...AGGREGATE_MODIFIERS, ...STAGES, ...QUERY_LOGICAL, ...QUERY_FIELD,
    ...UPDATE_OPERATORS, ...UPDATE_MODIFIERS, ...ACCUMULATORS, ...WINDOW_OPERATORS, ...EXPRESSIONS, ...PROJECTION_OPERATORS,
    ...SYSTEM_VARIABLES, ...BSON_HELPERS
];

/** Names `$type` takes. */
export const BSON_TYPES = ["double", "string", "object", "array", "binData", "objectId", "bool", "date", "null", "regex", "javascript", "int", "timestamp", "long", "decimal", "minKey", "maxKey", "number"];

export const FIND_OPTIONS = ["sort", "projection", "limit", "skip", "hint", "collation", "maxTimeMS", "batchSize", "comment", "let", "allowDiskUse", "readConcern", "min", "max", "returnKey", "showRecordId"];
export const AGGREGATE_OPTIONS = ["allowDiskUse", "maxTimeMS", "collation", "hint", "comment", "let", "bypassDocumentValidation", "readConcern", "writeConcern"];
export const UPDATE_OPTIONS = ["upsert", "arrayFilters", "collation", "hint", "let", "sort", "writeConcern", "bypassDocumentValidation", "comment"];
export const DELETE_OPTIONS = ["collation", "hint", "let", "writeConcern", "comment"];
export const FIND_AND_MODIFY_OPTIONS = ["returnDocument", "projection", "sort", "upsert", "arrayFilters", "collation", "hint", "let", "maxTimeMS", "writeConcern", "comment"];
export const INDEX_OPTIONS = ["name", "unique", "sparse", "expireAfterSeconds", "partialFilterExpression", "hidden", "collation", "wildcardProjection", "weights", "default_language", "language_override", "textIndexVersion", "2dsphereIndexVersion", "bits", "min", "max", "storageEngine", "prepareUnique"];
export const CREATE_COLLECTION_OPTIONS = ["capped", "size", "max", "timeseries", "expireAfterSeconds", "clusteredIndex", "changeStreamPreAndPostImages", "validator", "validationLevel", "validationAction", "collation", "storageEngine", "indexOptionDefaults", "encryptedFields", "writeConcern"];

export const COMMANDS = ["ping", "hello", "buildInfo", "serverStatus", "dbStats", "collStats", "listCollections", "listIndexes", "listDatabases", "find", "aggregate", "count", "distinct", "insert", "update", "delete", "findAndModify", "create", "collMod", "drop", "dropDatabase", "createIndexes", "dropIndexes", "renameCollection", "explain", "validate", "compact", "connectionStatus", "usersInfo", "rolesInfo", "createUser", "updateUser", "dropUser", "grantRolesToUser", "currentOp", "killOp", "profile", "getParameter", "setParameter", "replSetGetStatus", "top", "bulkWrite", "createSearchIndexes", "updateSearchIndex", "dropSearchIndex", "setQuerySettings", "removeQuerySettings", "analyzeShardKey", "getClusterParameter", "setClusterParameter"];

/** `7.0.4` is at least `7.0`; without a server version everything counts as available. */
export function available(entry: Entry, serverVersion: string | undefined): boolean {
    if (!entry.since || !serverVersion) return true;
    const [major = 0, minor = 0] = serverVersion.split(".").map(Number);
    const [needMajor = 0, needMinor = 0] = entry.since.split(".").map(Number);
    return major > needMajor || (major === needMajor && minor >= needMinor);
}
