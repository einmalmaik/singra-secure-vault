-- Migration: Vollständige Implementierung von Familien-Organisation & Geteilte Sammlungen
-- Erstellt: 2026-02-11
-- Beschreibung: Fügt fehlende Tabellen und Funktionalität für geteilte Sammlungen hinzu

-- =====================================================
-- 1. NEUE TABELLEN
-- =====================================================

-- User Key Pairs (RSA-4096 Public/Private Keys)
CREATE TABLE IF NOT EXISTS public.user_keys (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    public_key TEXT NOT NULL,
    encrypted_private_key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Collection Shared Keys (wrapped für jedes Mitglied)
CREATE TABLE IF NOT EXISTS public.collection_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID REFERENCES public.shared_collections(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    wrapped_key TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE (collection_id, user_id)
);

-- Audit Log für Collections
CREATE TABLE IF NOT EXISTS public.collection_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID REFERENCES public.shared_collections(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Indizes für Performance
CREATE INDEX IF NOT EXISTS idx_collection_keys_collection ON public.collection_keys(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_keys_user ON public.collection_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_collection ON public.collection_audit_log(collection_id, created_at DESC);

-- =====================================================
-- 2. SCHEMA-ÄNDERUNGEN FÜR BESTEHENDE TABELLEN
-- =====================================================

-- shared_collection_items: encrypted_data hinzufügen
ALTER TABLE public.shared_collection_items 
ADD COLUMN IF NOT EXISTS encrypted_data TEXT;

-- shared_collections: Metadaten hinzufügen
ALTER TABLE public.shared_collections
ADD COLUMN IF NOT EXISTS member_count INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS item_count INTEGER DEFAULT 0;

-- =====================================================
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- =====================================================

-- Enable RLS auf neuen Tabellen
ALTER TABLE public.user_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.collection_audit_log ENABLE ROW LEVEL SECURITY;

-- user_keys: Benutzer kann nur eigene Keys lesen/schreiben
CREATE POLICY "Users can read own keys"
    ON public.user_keys FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own keys"
    ON public.user_keys FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own keys"
    ON public.user_keys FOR UPDATE
    USING (auth.uid() = user_id);

-- collection_keys: Benutzer kann Keys für eigene Collections lesen
CREATE POLICY "Users can read collection keys"
    ON public.collection_keys FOR SELECT
    USING (
        user_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.shared_collections
            WHERE id = collection_id AND owner_id = auth.uid()
        )
    );

CREATE POLICY "Collection owners can insert keys"
    ON public.collection_keys FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shared_collections
            WHERE id = collection_id AND owner_id = auth.uid()
        )
    );

CREATE POLICY "Collection owners can delete keys"
    ON public.collection_keys FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.shared_collections
            WHERE id = collection_id AND owner_id = auth.uid()
        )
    );

-- collection_audit_log: Nur Collection-Besitzer und Mitglieder können Log lesen
CREATE POLICY "Collection members can read audit log"
    ON public.collection_audit_log FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.shared_collections
            WHERE id = collection_id AND owner_id = auth.uid()
        ) OR
        EXISTS (
            SELECT 1 FROM public.shared_collection_members
            WHERE collection_id = collection_audit_log.collection_id 
            AND user_id = auth.uid()
        )
    );

-- =====================================================
-- 4. TRIGGER FÜR AUDIT-LOG
-- =====================================================

-- Funktion zum Loggen von Collection-Änderungen
CREATE OR REPLACE FUNCTION public.log_collection_change()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO public.collection_audit_log (collection_id, user_id, action, details)
        VALUES (
            NEW.collection_id,
            auth.uid(),
            TG_TABLE_NAME || '_added',
            jsonb_build_object(
                'id', NEW.id,
                'table', TG_TABLE_NAME
            )
        );
        RETURN NEW;
    ELSIF TG_OP = 'UPDATE' THEN
        INSERT INTO public.collection_audit_log (collection_id, user_id, action, details)
        VALUES (
            NEW.collection_id,
            auth.uid(),
            TG_TABLE_NAME || '_updated',
            jsonb_build_object(
                'id', NEW.id,
                'table', TG_TABLE_NAME,
                'changes', jsonb_build_object(
                    'old', to_jsonb(OLD),
                    'new', to_jsonb(NEW)
                )
            )
        );
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        INSERT INTO public.collection_audit_log (collection_id, user_id, action, details)
        VALUES (
            OLD.collection_id,
            auth.uid(),
            TG_TABLE_NAME || '_removed',
            jsonb_build_object(
                'id', OLD.id,
                'table', TG_TABLE_NAME
            )
        );
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger für shared_collection_members
DROP TRIGGER IF EXISTS log_collection_members_changes ON public.shared_collection_members;
CREATE TRIGGER log_collection_members_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.shared_collection_members
    FOR EACH ROW EXECUTE FUNCTION public.log_collection_change();

-- Trigger für shared_collection_items
DROP TRIGGER IF EXISTS log_collection_items_changes ON public.shared_collection_items;
CREATE TRIGGER log_collection_items_changes
    AFTER INSERT OR UPDATE OR DELETE ON public.shared_collection_items
    FOR EACH ROW EXECUTE FUNCTION public.log_collection_change();

-- =====================================================
-- 5. TRIGGER FÜR MEMBER/ITEM COUNTS
-- =====================================================

-- Funktion zum Aktualisieren von member_count
CREATE OR REPLACE FUNCTION public.update_collection_member_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.shared_collections
        SET member_count = member_count + 1
        WHERE id = NEW.collection_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.shared_collections
        SET member_count = GREATEST(0, member_count - 1)
        WHERE id = OLD.collection_id;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger für member_count
DROP TRIGGER IF EXISTS update_member_count ON public.shared_collection_members;
CREATE TRIGGER update_member_count
    AFTER INSERT OR DELETE ON public.shared_collection_members
    FOR EACH ROW EXECUTE FUNCTION public.update_collection_member_count();

-- Funktion zum Aktualisieren von item_count
CREATE OR REPLACE FUNCTION public.update_collection_item_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.shared_collections
        SET item_count = item_count + 1
        WHERE id = NEW.collection_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.shared_collections
        SET item_count = GREATEST(0, item_count - 1)
        WHERE id = OLD.collection_id;
        RETURN OLD;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger für item_count
DROP TRIGGER IF EXISTS update_item_count ON public.shared_collection_items;
CREATE TRIGGER update_item_count
    AFTER INSERT OR DELETE ON public.shared_collection_items
    FOR EACH ROW EXECUTE FUNCTION public.update_collection_item_count();

-- =====================================================
-- 6. HELPER FUNCTIONS
-- =====================================================

-- Funktion zum Prüfen der Familiengröße
CREATE OR REPLACE FUNCTION public.check_family_size(owner_id UUID)
RETURNS INTEGER AS $$
DECLARE
    member_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO member_count
    FROM public.family_members
    WHERE family_owner_id = owner_id
    AND status = 'active';
    
    RETURN member_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funktion zum Prüfen des Subscription-Tiers
CREATE OR REPLACE FUNCTION public.check_subscription_tier(user_id UUID)
RETURNS TEXT AS $$
DECLARE
    tier TEXT;
BEGIN
    SELECT s.tier INTO tier
    FROM public.subscriptions s
    WHERE s.user_id = check_subscription_tier.user_id
    AND s.status = 'active'
    ORDER BY s.created_at DESC
    LIMIT 1;
    
    RETURN COALESCE(tier, 'free');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =====================================================
-- 7. DATEN-MIGRATION
-- =====================================================

-- Initialisiere member_count und item_count für bestehende Collections
UPDATE public.shared_collections
SET member_count = (
    SELECT COUNT(*)
    FROM public.shared_collection_members
    WHERE collection_id = shared_collections.id
),
item_count = (
    SELECT COUNT(*)
    FROM public.shared_collection_items
    WHERE collection_id = shared_collections.id
)
WHERE member_count = 0 AND item_count = 0;

-- =====================================================
-- 8. KOMMENTARE
-- =====================================================

COMMENT ON TABLE public.user_keys IS 'RSA-4096 Public/Private Key Pairs für Benutzer (Private Key verschlüsselt mit Master-Passwort)';
COMMENT ON TABLE public.collection_keys IS 'Shared Encryption Keys für Collections (wrapped mit User Public Keys)';
COMMENT ON TABLE public.collection_audit_log IS 'Audit-Log für alle Änderungen an Collections';
COMMENT ON FUNCTION public.log_collection_change() IS 'Trigger-Funktion zum automatischen Loggen von Collection-Änderungen';
COMMENT ON FUNCTION public.check_family_size(UUID) IS 'Prüft die Anzahl aktiver Familienmitglieder';
COMMENT ON FUNCTION public.check_subscription_tier(UUID) IS 'Gibt den aktuellen Subscription-Tier eines Benutzers zurück';
