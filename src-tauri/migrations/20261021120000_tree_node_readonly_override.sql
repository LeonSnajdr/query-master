-- Read-only of a row has three states: null takes what the row above has, 1 is read-only, 0 is
-- writable even below a read-only row. SQLite can not change a check, so the table is built anew;
-- the 0 of rows that only noted color, comment or folder becomes null.
create table tree_node_new
(
    connection_id blob    not null references connection (id) on delete cascade,
    path          text    not null,
    color         text,
    comment       text,
    readonly      integer check (readonly in (0, 1)),
    folder        text,
    primary key (connection_id, path)
) strict;

insert into tree_node_new (connection_id, path, color, comment, readonly, folder)
select connection_id, path, color, comment, nullif(readonly, 0), folder
from tree_node;

drop table tree_node;

alter table tree_node_new rename to tree_node;
