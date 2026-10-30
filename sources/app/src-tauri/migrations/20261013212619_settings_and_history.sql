-- One row: the settings of this installation. A null means "not chosen": follow the system.
create table setting
(
    id       integer not null primary key check (id = 1),
    language text,
    theme    text
) strict;

-- Statements that ran, per connection.
create table history
(
    id            integer not null primary key autoincrement,
    connection_id blob    not null references connection (id) on delete cascade,
    database_name text    not null,
    statement     text    not null,
    date_executed text    not null
) strict;

create index idx_history_connection on history (connection_id, id desc);
