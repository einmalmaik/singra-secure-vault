-- Remove persisted master password hints from all existing profiles.
-- Decision date: 2026-02-08
update public.profiles
set master_password_hint = null
where master_password_hint is not null;
