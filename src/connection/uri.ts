/**
 * A connection string and the fields of the connection dialog, each made from the other. What the
 * dialog has no field for stays in `extra` and comes back unchanged.
 */

export type ConnectMode = "single" | "replicaSet" | "srv";
export type AuthMode = "none" | "scram" | "x509" | "aws" | "ldap";
export const AUTH_MECHANISMS: Record<Exclude<AuthMode, "none">, string> = {
    scram: "SCRAM-SHA-256",
    x509: "MONGODB-X509",
    aws: "MONGODB-AWS",
    ldap: "PLAIN"
};

export interface Host {
    host: string;
    port: number;
}

export interface ConnectionFields {
    mode: ConnectMode;
    hosts: Host[];
    replicaSet: string;
    /** The database the string names after the hosts. */
    database: string;
    auth: AuthMode;
    username: string;
    password: string;
    authSource: string;
    tls: boolean;
    tlsAllowInvalidCertificates: boolean;
    tlsCAFile: string;
    tlsCertificateKeyFile: string;
    /** Passphrase of the key file; it lies in the keychain with the rest of the string. */
    tlsCertificateKeyFilePassword: string;
    tlsAllowInvalidHostnames: boolean;
    /** `primary`, `secondary` …; empty for the driver's default (primary). */
    readPreference: string;
    /** In seconds, as the dialog shows them; empty means the driver's default. */
    connectTimeout: string;
    serverSelectionTimeout: string;
    maxIdleTime: string;
    retryWrites: boolean;
    /** Options without a field, in their order. */
    extra: [string, string][];
}

export const DEFAULT_PORT = 27017;

export function emptyFields(): ConnectionFields {
    return {
        mode: "single",
        hosts: [{ host: "localhost", port: DEFAULT_PORT }],
        replicaSet: "",
        database: "",
        auth: "none",
        username: "",
        password: "",
        authSource: "",
        tls: false,
        tlsAllowInvalidCertificates: false,
        tlsCAFile: "",
        tlsCertificateKeyFile: "",
        tlsCertificateKeyFilePassword: "",
        tlsAllowInvalidHostnames: false,
        readPreference: "",
        connectTimeout: "",
        serverSelectionTimeout: "",
        maxIdleTime: "",
        retryWrites: true,
        extra: []
    };
}

/** Options with a field of their own; matched without regard to case, as the driver does. */
const KNOWN = ["replicaset", "authsource", "authmechanism", "tls", "ssl", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames", "tlscafile", "tlscertificatekeyfile", "tlscertificatekeyfilepassword", "readpreference", "connecttimeoutms", "serverselectiontimeoutms", "maxidletimems", "retrywrites"];

function seconds(milliseconds: string | undefined): string {
    if (milliseconds === undefined || milliseconds === "") return "";
    const value = Number(milliseconds) / 1000;
    return Number.isFinite(value) ? String(value) : "";
}

function milliseconds(text: string): string | undefined {
    if (text.trim() === "") return undefined;
    const value = Number(text.replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? String(Math.round(value * 1000)) : undefined;
}

/** Reads a connection string; throws for one that is not `mongodb://` or `mongodb+srv://`. */
export function parseUri(uri: string): ConnectionFields {
    const match = /^(mongodb(?:\+srv)?):\/\/([^/?]*)(?:\/([^?]*))?(?:\?(.*))?$/.exec(uri.trim());
    if (!match) throw new Error("not a connection string");
    const [, scheme, authority = "", path = "", query = ""] = match;
    const fields = emptyFields();
    fields.mode = scheme === "mongodb+srv" ? "srv" : "single";
    // SRV turns TLS on unless the string says otherwise.
    fields.tls = fields.mode === "srv";
    fields.database = decodeURIComponent(path);

    // Credentials end at the last `@`: a password may hold an encoded one only.
    const at = authority.lastIndexOf("@");
    const hosts = at === -1 ? authority : authority.slice(at + 1);
    if (at !== -1) {
        const credentials = authority.slice(0, at);
        const colon = credentials.indexOf(":");
        fields.username = decodeURIComponent(colon === -1 ? credentials : credentials.slice(0, colon));
        fields.password = colon === -1 ? "" : decodeURIComponent(credentials.slice(colon + 1));
        fields.auth = "scram";
    }
    fields.hosts = hosts.split(",").filter(Boolean).map((entry) => {
        // `[::1]:27017`: an IPv6 address carries brackets.
        const parsed = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(entry);
        return { host: parsed?.[1] ?? entry, port: parsed?.[2] ? Number(parsed[2]) : DEFAULT_PORT };
    });
    if (fields.hosts.length === 0) fields.hosts = [{ host: "localhost", port: DEFAULT_PORT }];

    for (const pair of query.split("&").filter(Boolean)) {
        const equals = pair.indexOf("=");
        const name = decodeURIComponent(equals === -1 ? pair : pair.slice(0, equals));
        const value = decodeURIComponent(equals === -1 ? "" : pair.slice(equals + 1));
        switch (name.toLowerCase()) {
            case "replicaset":
                fields.replicaSet = value;
                if (fields.mode === "single") fields.mode = "replicaSet";
                break;
            case "authsource":
                fields.authSource = value;
                break;
            case "authmechanism": {
                const found = (Object.entries(AUTH_MECHANISMS) as [AuthMode, string][]).find(([, mechanism]) => mechanism === value.toUpperCase());
                // SCRAM-SHA-1, GSSAPI and the like have no choice of their own: read as SCRAM, the
                // mechanism stays in `extra` and is written back as it was.
                if (found) {
                    fields.auth = found[0];
                } else {
                    fields.auth = "scram";
                    fields.extra.push([name, value]);
                }
                break;
            }
            case "tls":
            case "ssl":
                fields.tls = value === "true";
                break;
            case "tlsallowinvalidcertificates":
                fields.tlsAllowInvalidCertificates = value === "true";
                break;
            case "tlscafile":
                fields.tlsCAFile = value;
                break;
            case "tlscertificatekeyfile":
                fields.tlsCertificateKeyFile = value;
                break;
            case "tlscertificatekeyfilepassword":
                fields.tlsCertificateKeyFilePassword = value;
                break;
            case "tlsallowinvalidhostnames":
                fields.tlsAllowInvalidHostnames = value === "true";
                break;
            case "readpreference":
                fields.readPreference = value;
                break;
            case "connecttimeoutms":
                fields.connectTimeout = seconds(value);
                break;
            case "serverselectiontimeoutms":
                fields.serverSelectionTimeout = seconds(value);
                break;
            case "maxidletimems":
                fields.maxIdleTime = seconds(value);
                break;
            case "retrywrites":
                fields.retryWrites = value !== "false";
                break;
            default: fields.extra.push([name, value]);
        }
    }
    if (fields.mode === "single" && fields.hosts.length > 1) fields.mode = "replicaSet";
    return fields;
}

/** The string without the password (the user stays), to show or pass on; unchanged without one. */
export function withoutPassword(uri: string): string {
    // Credentials end at the last `@` before the path, as in `parseUri`; the key's passphrase is one too.
    const withoutKey = uri.replace(/([?&])tlsCertificateKeyFilePassword=[^&]*(&?)/i, (_whole, before: string, after: string) => (after ? before : ""));
    return withoutKey.replace(/^(mongodb(?:\+srv)?:\/\/)([^/?]*)@/, (whole, scheme: string, credentials: string) => {
        const colon = credentials.indexOf(":");
        return colon === -1 ? whole : `${scheme}${credentials.slice(0, colon)}@`;
    });
}

/**
 * A string to show, first without its password (as the *Include passwords*, off at
 * first); with one, the full string as the second variant. `say` gives the labels their text.
 */
export function uriVariants(uri: string, say: (key: string) => string): { label: string; text: string }[] | undefined {
    const shown = withoutPassword(uri);
    return shown === uri ? undefined : [{ label: say("connection.uri.withoutPassword"), text: shown }, { label: say("connection.uri.withPassword"), text: uri }];
}

/** Writes the fields as a connection string. */
export function buildUri(fields: ConnectionFields): string {
    const srv = fields.mode === "srv";
    const hosts = (fields.mode === "single" ? fields.hosts.slice(0, 1) : fields.hosts)
        .filter(item => item.host.trim() !== "")
        .map(item => (srv || item.port === DEFAULT_PORT ? item.host.trim() : `${item.host.trim()}:${item.port}`));
    const withCredentials = fields.auth !== "none" && fields.auth !== "x509" && fields.username !== "";
    const credentials = withCredentials
        ? `${encodeURIComponent(fields.username)}${fields.password ? `:${encodeURIComponent(fields.password)}` : ""}@`
        : "";

    // A mechanism without a choice of its own (SCRAM-SHA-1, GSSAPI …) was read as SCRAM; it stays
    // while SCRAM is chosen, and gives way to any other choice.
    const otherMechanism = fields.auth === "scram" ? fields.extra.find(([name]) => name.toLowerCase() === "authmechanism")?.[1] : undefined;
    const options: [string, string | undefined][] = [
        ["replicaSet", fields.mode === "replicaSet" && fields.replicaSet ? fields.replicaSet : undefined],
        ["authSource", fields.auth !== "none" && fields.authSource ? fields.authSource : undefined],
        ["authMechanism", fields.auth === "none" || fields.auth === "scram" ? otherMechanism : AUTH_MECHANISMS[fields.auth]],
        // SRV turns TLS on by itself; it is written only where it differs from that.
        ["tls", fields.tls !== srv ? String(fields.tls) : undefined],
        ["tlsAllowInvalidCertificates", fields.tls && fields.tlsAllowInvalidCertificates ? "true" : undefined],
        ["tlsCAFile", fields.tls && fields.tlsCAFile ? fields.tlsCAFile : undefined],
        ["tlsCertificateKeyFile", fields.tls && fields.tlsCertificateKeyFile ? fields.tlsCertificateKeyFile : undefined],
        ["tlsCertificateKeyFilePassword", fields.tls && fields.tlsCertificateKeyFile && fields.tlsCertificateKeyFilePassword ? fields.tlsCertificateKeyFilePassword : undefined],
        ["tlsAllowInvalidHostnames", fields.tls && fields.tlsAllowInvalidHostnames ? "true" : undefined],
        ["connectTimeoutMS", milliseconds(fields.connectTimeout)],
        ["serverSelectionTimeoutMS", milliseconds(fields.serverSelectionTimeout)],
        ["maxIdleTimeMS", milliseconds(fields.maxIdleTime)],
        ["retryWrites", fields.retryWrites ? undefined : "false"],
        ["readPreference", fields.readPreference || undefined],
        ...fields.extra.filter(([name]) => !KNOWN.includes(name.toLowerCase()))
    ];
    const query = options
        .filter((option): option is [string, string] => option[1] !== undefined)
        .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
        .join("&");
    const path = fields.database || query ? `/${encodeURIComponent(fields.database)}` : "";
    return `${srv ? "mongodb+srv" : "mongodb"}://${credentials}${hosts.join(",")}${path}${query ? `?${query}` : ""}`;
}
