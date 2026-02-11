-- Create core 2FA tables used by frontend/service layer.

CREATE TABLE IF NOT EXISTS public.user_2fa (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    totp_secret TEXT,
    is_enabled BOOLEAN DEFAULT FALSE,
    vault_2fa_enabled BOOLEAN DEFAULT FALSE,
    enabled_at TIMESTAMP WITH TIME ZONE,
    last_verified_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.backup_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    code_hash TEXT NOT NULL,
    is_used BOOLEAN DEFAULT FALSE,
    used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, code_hash)
);

ALTER TABLE public.user_2fa ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_codes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_2fa' AND policyname = 'Users can view own 2FA settings'
    ) THEN
        CREATE POLICY "Users can view own 2FA settings"
            ON public.user_2fa FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_2fa' AND policyname = 'Users can manage own 2FA settings'
    ) THEN
        CREATE POLICY "Users can manage own 2FA settings"
            ON public.user_2fa FOR ALL
            TO authenticated
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'backup_codes' AND policyname = 'Users can view own backup codes'
    ) THEN
        CREATE POLICY "Users can view own backup codes"
            ON public.backup_codes FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'backup_codes' AND policyname = 'Users can manage own backup codes'
    ) THEN
        CREATE POLICY "Users can manage own backup codes"
            ON public.backup_codes FOR ALL
            TO authenticated
            USING (auth.uid() = user_id)
            WITH CHECK (auth.uid() = user_id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_user_2fa_user_id ON public.user_2fa(user_id);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id ON public.backup_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_backup_codes_user_id_is_used ON public.backup_codes(user_id, is_used);

DROP TRIGGER IF EXISTS update_user_2fa_updated_at ON public.user_2fa;
CREATE TRIGGER update_user_2fa_updated_at
    BEFORE UPDATE ON public.user_2fa
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
