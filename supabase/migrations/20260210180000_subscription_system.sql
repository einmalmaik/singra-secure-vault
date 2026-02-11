-- ============================================
-- Singra PW - Subscription System Migration
-- Adds subscription columns, feature tables,
-- and updates handle_new_user trigger
-- ============================================

-- ============================================
-- 1. SUBSCRIPTIONS TABLE (base + compatibility columns)
-- ============================================
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    tier TEXT DEFAULT 'free',
    status TEXT DEFAULT 'active',
    stripe_customer_id TEXT,
    stripe_subscription_id TEXT,
    current_period_end TIMESTAMP WITH TIME ZONE,
    has_used_intro_discount BOOLEAN DEFAULT FALSE,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    stripe_price_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS has_used_intro_discount BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stripe_price_id TEXT;

-- ============================================
-- 2. EMERGENCY ACCESS TABLE
-- Premium feature: designate a trusted contact
-- ============================================
CREATE TABLE IF NOT EXISTS public.emergency_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grantor_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    trusted_email TEXT NOT NULL,
    trusted_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    wait_days INTEGER NOT NULL DEFAULT 7 CHECK (wait_days >= 1 AND wait_days <= 90),
    status TEXT NOT NULL DEFAULT 'invited'
      CHECK (status IN ('invited', 'accepted', 'pending', 'granted', 'rejected', 'expired')),
    requested_at TIMESTAMP WITH TIME ZONE,
    granted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- ============================================
-- 3. FILE ATTACHMENTS TABLE
-- Premium feature: 1 GB per account
-- ============================================
CREATE TABLE IF NOT EXISTS public.file_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    vault_item_id UUID REFERENCES public.vault_items(id) ON DELETE CASCADE NOT NULL,
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    storage_path TEXT NOT NULL,
    mime_type TEXT,
    encrypted BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- ============================================
-- 4. FAMILY MEMBERS TABLE
-- Families feature: up to 6 accounts
-- ============================================
CREATE TABLE IF NOT EXISTS public.family_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    member_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    member_email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member'
      CHECK (role IN ('owner', 'member')),
    status TEXT NOT NULL DEFAULT 'invited'
      CHECK (status IN ('invited', 'active', 'removed')),
    invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE,
    UNIQUE (family_owner_id, member_email)
);

-- ============================================
-- 5. SHARED COLLECTIONS TABLE
-- Families feature: shared password collections
-- ============================================
CREATE TABLE IF NOT EXISTS public.shared_collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.shared_collection_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID REFERENCES public.shared_collections(id) ON DELETE CASCADE NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    permission TEXT NOT NULL DEFAULT 'view'
      CHECK (permission IN ('view', 'edit')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE (collection_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.shared_collection_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID REFERENCES public.shared_collections(id) ON DELETE CASCADE NOT NULL,
    vault_item_id UUID REFERENCES public.vault_items(id) ON DELETE CASCADE NOT NULL,
    added_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE (collection_id, vault_item_id)
);

-- ============================================
-- 6. UPDATE handle_new_user() TRIGGER
-- Auto-create FREE subscription on signup
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    -- Create profile
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));

    -- Assign default user role
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');

    -- Create default vault
    INSERT INTO public.vaults (user_id, name, is_default)
    VALUES (NEW.id, 'Persönlicher Tresor', TRUE);

    -- Create default FREE subscription
    INSERT INTO public.subscriptions (user_id, tier, status)
    VALUES (NEW.id, 'free', 'active');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================
-- 7. TRIGGERS for updated_at
-- ============================================
DROP TRIGGER IF EXISTS update_emergency_access_updated_at ON public.emergency_access;
CREATE TRIGGER update_emergency_access_updated_at
    BEFORE UPDATE ON public.emergency_access
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_file_attachments_updated_at ON public.file_attachments;
CREATE TRIGGER update_file_attachments_updated_at
    BEFORE UPDATE ON public.file_attachments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_shared_collections_updated_at ON public.shared_collections;
CREATE TRIGGER update_shared_collections_updated_at
    BEFORE UPDATE ON public.shared_collections
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 8. ENABLE RLS on new tables
-- ============================================
ALTER TABLE public.emergency_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.file_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_collection_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_collection_items ENABLE ROW LEVEL SECURITY;

-- ============================================
-- 9. RLS POLICIES
-- ============================================

-- SUBSCRIPTIONS: users can read own subscription
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- EMERGENCY ACCESS: grantor can manage, trusted user can view
DROP POLICY IF EXISTS "Grantors can view own emergency access" ON public.emergency_access;
CREATE POLICY "Grantors can view own emergency access"
    ON public.emergency_access FOR SELECT
    TO authenticated
    USING (auth.uid() = grantor_id OR auth.uid() = trusted_user_id);

DROP POLICY IF EXISTS "Grantors can create emergency access" ON public.emergency_access;
CREATE POLICY "Grantors can create emergency access"
    ON public.emergency_access FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = grantor_id);

DROP POLICY IF EXISTS "Grantors can update emergency access" ON public.emergency_access;
CREATE POLICY "Grantors can update emergency access"
    ON public.emergency_access FOR UPDATE
    TO authenticated
    USING (auth.uid() = grantor_id OR auth.uid() = trusted_user_id)
    WITH CHECK (auth.uid() = grantor_id OR auth.uid() = trusted_user_id);

DROP POLICY IF EXISTS "Grantors can delete emergency access" ON public.emergency_access;
CREATE POLICY "Grantors can delete emergency access"
    ON public.emergency_access FOR DELETE
    TO authenticated
    USING (auth.uid() = grantor_id);

-- FILE ATTACHMENTS: owner only
DROP POLICY IF EXISTS "Users can view own file attachments" ON public.file_attachments;
CREATE POLICY "Users can view own file attachments"
    ON public.file_attachments FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own file attachments" ON public.file_attachments;
CREATE POLICY "Users can create own file attachments"
    ON public.file_attachments FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own file attachments" ON public.file_attachments;
CREATE POLICY "Users can update own file attachments"
    ON public.file_attachments FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own file attachments" ON public.file_attachments;
CREATE POLICY "Users can delete own file attachments"
    ON public.file_attachments FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- FAMILY MEMBERS: owner can manage, members can view
DROP POLICY IF EXISTS "Family owners can view family members" ON public.family_members;
CREATE POLICY "Family owners can view family members"
    ON public.family_members FOR SELECT
    TO authenticated
    USING (auth.uid() = family_owner_id OR auth.uid() = member_user_id);

DROP POLICY IF EXISTS "Family owners can create family members" ON public.family_members;
CREATE POLICY "Family owners can create family members"
    ON public.family_members FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = family_owner_id);

DROP POLICY IF EXISTS "Family owners can update family members" ON public.family_members;
CREATE POLICY "Family owners can update family members"
    ON public.family_members FOR UPDATE
    TO authenticated
    USING (auth.uid() = family_owner_id)
    WITH CHECK (auth.uid() = family_owner_id);

DROP POLICY IF EXISTS "Family owners can delete family members" ON public.family_members;
CREATE POLICY "Family owners can delete family members"
    ON public.family_members FOR DELETE
    TO authenticated
    USING (auth.uid() = family_owner_id);

-- SHARED COLLECTIONS: owner + members with permission
DROP POLICY IF EXISTS "Users can view own or shared collections" ON public.shared_collections;
CREATE POLICY "Users can view own or shared collections"
    ON public.shared_collections FOR SELECT
    TO authenticated
    USING (
        auth.uid() = owner_id OR
        EXISTS (
            SELECT 1 FROM public.shared_collection_members scm
            WHERE scm.collection_id = shared_collections.id
            AND scm.user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Users can create own collections" ON public.shared_collections;
CREATE POLICY "Users can create own collections"
    ON public.shared_collections FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can update own collections" ON public.shared_collections;
CREATE POLICY "Users can update own collections"
    ON public.shared_collections FOR UPDATE
    TO authenticated
    USING (auth.uid() = owner_id)
    WITH CHECK (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Users can delete own collections" ON public.shared_collections;
CREATE POLICY "Users can delete own collections"
    ON public.shared_collections FOR DELETE
    TO authenticated
    USING (auth.uid() = owner_id);

-- SHARED COLLECTION MEMBERS
DROP POLICY IF EXISTS "Collection owners and members can view members" ON public.shared_collection_members;
CREATE POLICY "Collection owners and members can view members"
    ON public.shared_collection_members FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.shared_collections sc
            WHERE sc.id = shared_collection_members.collection_id
            AND sc.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Collection owners can manage members" ON public.shared_collection_members;
CREATE POLICY "Collection owners can manage members"
    ON public.shared_collection_members FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shared_collections sc
            WHERE sc.id = shared_collection_members.collection_id
            AND sc.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Collection owners can update members" ON public.shared_collection_members;
CREATE POLICY "Collection owners can update members"
    ON public.shared_collection_members FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shared_collections sc
            WHERE sc.id = shared_collection_members.collection_id
            AND sc.owner_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Collection owners can delete members" ON public.shared_collection_members;
CREATE POLICY "Collection owners can delete members"
    ON public.shared_collection_members FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shared_collections sc
            WHERE sc.id = shared_collection_members.collection_id
            AND sc.owner_id = auth.uid()
        )
    );

-- SHARED COLLECTION ITEMS
DROP POLICY IF EXISTS "Collection members can view items" ON public.shared_collection_items;
CREATE POLICY "Collection members can view items"
    ON public.shared_collection_items FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shared_collections sc
            WHERE sc.id = shared_collection_items.collection_id
            AND (
                sc.owner_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM public.shared_collection_members scm
                    WHERE scm.collection_id = sc.id AND scm.user_id = auth.uid()
                )
            )
        )
    );

DROP POLICY IF EXISTS "Collection editors can add items" ON public.shared_collection_items;
CREATE POLICY "Collection editors can add items"
    ON public.shared_collection_items FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.shared_collections sc
            WHERE sc.id = shared_collection_items.collection_id
            AND (
                sc.owner_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM public.shared_collection_members scm
                    WHERE scm.collection_id = sc.id
                    AND scm.user_id = auth.uid()
                    AND scm.permission = 'edit'
                )
            )
        )
    );

DROP POLICY IF EXISTS "Collection editors can delete items" ON public.shared_collection_items;
CREATE POLICY "Collection editors can delete items"
    ON public.shared_collection_items FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.shared_collections sc
            WHERE sc.id = shared_collection_items.collection_id
            AND (
                sc.owner_id = auth.uid() OR
                EXISTS (
                    SELECT 1 FROM public.shared_collection_members scm
                    WHERE scm.collection_id = sc.id
                    AND scm.user_id = auth.uid()
                    AND scm.permission = 'edit'
                )
            )
        )
    );

-- ============================================
-- 10. INDEXES for performance
-- ============================================
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer_id ON public.subscriptions(stripe_customer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON public.subscriptions(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_emergency_access_grantor_id ON public.emergency_access(grantor_id);
CREATE INDEX IF NOT EXISTS idx_emergency_access_trusted_user_id ON public.emergency_access(trusted_user_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_user_id ON public.file_attachments(user_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_vault_item_id ON public.file_attachments(vault_item_id);
CREATE INDEX IF NOT EXISTS idx_family_members_owner_id ON public.family_members(family_owner_id);
CREATE INDEX IF NOT EXISTS idx_family_members_member_id ON public.family_members(member_user_id);
CREATE INDEX IF NOT EXISTS idx_shared_collections_owner_id ON public.shared_collections(owner_id);
CREATE INDEX IF NOT EXISTS idx_shared_collection_members_collection_id ON public.shared_collection_members(collection_id);
CREATE INDEX IF NOT EXISTS idx_shared_collection_members_user_id ON public.shared_collection_members(user_id);
CREATE INDEX IF NOT EXISTS idx_shared_collection_items_collection_id ON public.shared_collection_items(collection_id);
