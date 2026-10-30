-- What the app notes on a row of the connection tree: color, comment, read-only. The path is
-- empty for the connection itself, the database name, or `database/collection` (a database name
-- can not hold a slash, so the first one separates). Rows without any note are not kept.
create table tree_node
(
    connection_id blob    not null references connection (id) on delete cascade,
    path          text    not null,
    color         text,
    comment       text,
    readonly      integer not null default 0 check (readonly in (0, 1)),
    primary key (connection_id, path)
) strict;
