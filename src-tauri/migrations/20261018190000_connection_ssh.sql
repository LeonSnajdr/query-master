-- A connection made through an SSH server; its password or key passphrase lies in the keychain.
create table connection_ssh
(
    connection_id blob    not null primary key references connection (id) on delete cascade,
    host          text    not null,
    port          integer not null check (port between 1 and 65535),
    username      text    not null,
    method        text    not null check (method in ('password', 'key')),
    -- The private key file; empty with a password.
    key_path      text    not null
) strict;
