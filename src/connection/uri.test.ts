import { describe, expect, it } from "vitest";
import { buildUri, emptyFields, parseUri, withoutPassword } from "./uri";

describe("connection string and fields", () => {
    it("reads hosts, credentials, database and the options with a field", () => {
        const fields = parseUri("mongodb://us%40er:p%3Ass%40word@a:1,b,[::1]:27018/shop?replicaSet=rs0&authSource=admin&tls=true&connectTimeoutMS=30000&retryWrites=false&appName=x");
        expect(fields).toMatchObject({
            mode: "replicaSet",
            hosts: [{ host: "a", port: 1 }, { host: "b", port: 27017 }, { host: "[::1]", port: 27018 }],
            replicaSet: "rs0",
            database: "shop",
            auth: "scram",
            username: "us@er",
            password: "p:ss@word",
            authSource: "admin",
            tls: true,
            connectTimeout: "30",
            retryWrites: false,
            extra: [["appName", "x"]]
        });
    });

    it("writes what it read, options it has no field for included", () => {
        const uris = [
            "mongodb://localhost",
            "mongodb://user:secret@host:27018/shop?authSource=admin",
            "mongodb://a,b:27018/?replicaSet=rs0&tls=true&tlsAllowInvalidCertificates=true",
            "mongodb+srv://me:p%40ss@cluster0.example.net/?appName=QueryMaster",
            "mongodb://h/?authMechanism=MONGODB-X509&tls=true&tlsCertificateKeyFile=C%3A%5Ccert.pem",
            "mongodb://h/?serverSelectionTimeoutMS=7000&maxIdleTimeMS=1500&retryWrites=false&readPreference=secondary"
        ];
        for (const uri of uris) expect(buildUri(parseUri(uri))).toBe(uri);
    });

    it("keeps a mechanism without a choice of its own while SCRAM stays chosen", () => {
        for (const uri of [
            "mongodb://user:secret@h/?authSource=admin&authMechanism=SCRAM-SHA-1",
            "mongodb://user%40REALM@h/?authSource=%24external&authMechanism=GSSAPI",
            "mongodb://h/?authMechanism=GSSAPI"
        ]) {
            expect(parseUri(uri).auth).toBe("scram");
            expect(buildUri(parseUri(uri))).toBe(uri);
        }
        const fields = parseUri("mongodb://user@h/?authMechanism=GSSAPI");
        expect(buildUri({ ...fields, auth: "ldap" })).toBe("mongodb://user@h/?authMechanism=PLAIN");
        expect(buildUri({ ...fields, auth: "none" })).toBe("mongodb://h");
    });

    it("leaves out what the mode does not use", () => {
        const fields = { ...emptyFields(), hosts: [{ host: "a", port: 27017 }, { host: "b", port: 1 }], replicaSet: "rs0" };
        expect(buildUri(fields)).toBe("mongodb://a");
        expect(buildUri({ ...fields, mode: "srv", tls: true })).toBe("mongodb+srv://a,b");
        expect(buildUri({ ...fields, auth: "x509", username: "CN=me", tls: true })).toBe("mongodb://a/?authMechanism=MONGODB-X509&tls=true");
    });

    it("leaves out the password to show a string", () => {
        expect(withoutPassword("mongodb://us%40er:p%3As%40s@a,b/shop?authSource=admin")).toBe("mongodb://us%40er@a,b/shop?authSource=admin");
        expect(withoutPassword("mongodb+srv://me:x@cluster0.example.net")).toBe("mongodb+srv://me@cluster0.example.net");
        expect(withoutPassword("mongodb://user@h/?authMechanism=GSSAPI")).toBe("mongodb://user@h/?authMechanism=GSSAPI");
        expect(withoutPassword("mongodb://localhost")).toBe("mongodb://localhost");
    });

    it("refuses what is not a connection string", () => {
        expect(() => parseUri("http://localhost")).toThrow();
    });
});
