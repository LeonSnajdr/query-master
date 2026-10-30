-- Folders group the collections of a database in the tree. A folder is kept even while empty;
-- a collection names its folder in its row of tree_node.
create table tree_folder
(
    connection_id blob not null references connection (id) on delete cascade,
    database_name text not null,
    name          text not null check (length(trim(name)) > 0),
    primary key (connection_id, database_name, name)
) strict;

alter table tree_node add column folder text;
