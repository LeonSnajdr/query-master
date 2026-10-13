-- `strict`: a column takes only values of its declared type.
create table connection
(
    id             blob not null primary key,
    name           text not null,
    -- The connection string without credentials; the string itself lies in the keychain.
    address        text not null,
    date_created   text not null,
    date_last_used text
) strict;
