-- Folders of saved connections, also empty ones: the whole path, nested with "/" (`Kunden/Produktion`).
-- A connection lies in the folder its `group_name` names; a folder of a connection needs no row here.
create table connection_folder (
    name text primary key not null
);

insert or ignore into connection_folder (name)
select distinct group_name from connection where group_name <> '';
