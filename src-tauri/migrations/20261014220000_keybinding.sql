-- The keyboard shortcuts the user changed; every other command keeps the default of the app.
-- keys is a JSON array of at most two combinations such as "ctrl+shift+q"; [] means no shortcut.
create table keybinding (
    command_id text primary key not null,
    keys text not null check (json_valid(keys) and json_type(keys) = 'array' and json_array_length(keys) <= 2)
);
