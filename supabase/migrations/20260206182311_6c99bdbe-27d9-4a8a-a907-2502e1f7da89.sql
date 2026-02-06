-- ============================================
-- Zingra PW - Secure Password Manager Schema
-- Phase 1: Database Foundation
-- ============================================

-- 1. Create Enum for User Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

-- 2. Create Enum for Vault Item Types
CREATE TYPE public.vault_item_type AS ENUM ('password', 'note', 'totp');

-- ============================================
-- PROFILES TABLE
-- Stores public user profile information
-- ============================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
    display_name TEXT,
    avatar_url TEXT,
    preferred_language TEXT DEFAULT 'de' CHECK (preferred_language IN ('de', 'en')),
    theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
    -- Master password verification hash (NOT the actual master password)
    -- This is a hash of the derived key, used only to verify correct master password entry
    master_password_hint TEXT,
    encryption_salt TEXT, -- Salt used for key derivation (safe to store)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- ============================================
-- USER ROLES TABLE
-- Separate table for roles (security best practice)
-- ============================================
CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE (user_id, role)
);

-- ============================================
-- CATEGORIES TABLE
-- Folders for organizing vault items
-- ============================================
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    icon TEXT DEFAULT 'folder',
    color TEXT DEFAULT '#6366f1',
    parent_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- ============================================
-- TAGS TABLE
-- Flexible labels for filtering
-- ============================================
CREATE TABLE public.tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE (user_id, name)
);

-- ============================================
-- VAULTS TABLE
-- Container for vault items (for future multi-vault support)
-- ============================================
CREATE TABLE public.vaults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    name TEXT NOT NULL DEFAULT 'Persönlicher Tresor',
    description TEXT,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- ============================================
-- VAULT ITEMS TABLE
-- Encrypted password entries, notes, and TOTP secrets
-- ALL sensitive data is encrypted client-side before storage
-- ============================================
CREATE TABLE public.vault_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    vault_id UUID REFERENCES public.vaults(id) ON DELETE CASCADE NOT NULL,
    category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
    
    -- Item type
    item_type vault_item_type NOT NULL DEFAULT 'password',
    
    -- Encrypted fields (AES-256-GCM encrypted, stored as base64)
    encrypted_data TEXT NOT NULL, -- Contains all sensitive data as encrypted JSON
    
    -- Metadata (not sensitive, helps with search/display without decryption)
    title TEXT NOT NULL, -- Can be encrypted or plain based on user preference
    website_url TEXT,
    icon_url TEXT,
    
    -- Organization
    is_favorite BOOLEAN DEFAULT FALSE,
    sort_order INTEGER DEFAULT 0,
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE
);

-- ============================================
-- VAULT ITEM TAGS (Junction Table)
-- ============================================
CREATE TABLE public.vault_item_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vault_item_id UUID REFERENCES public.vault_items(id) ON DELETE CASCADE NOT NULL,
    tag_id UUID REFERENCES public.tags(id) ON DELETE CASCADE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
    UNIQUE (vault_item_id, tag_id)
);

-- ============================================
-- SECURITY DEFINER FUNCTION FOR ROLE CHECKS
-- Prevents recursive RLS issues
-- ============================================
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles
        WHERE user_id = _user_id
          AND role = _role
    )
$$;

-- ============================================
-- TRIGGER FUNCTION FOR UPDATED_AT
-- ============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGER FUNCTION: Auto-create profile on signup
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
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================
-- TRIGGERS
-- ============================================

-- Updated_at triggers
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_categories_updated_at
    BEFORE UPDATE ON public.categories
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vaults_updated_at
    BEFORE UPDATE ON public.vaults
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_vault_items_updated_at
    BEFORE UPDATE ON public.vault_items
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile trigger
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vault_item_tags ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- USER ROLES POLICIES (Read-only for users, admins can manage)
CREATE POLICY "Users can view own roles"
    ON public.user_roles FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- CATEGORIES POLICIES
CREATE POLICY "Users can view own categories"
    ON public.categories FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own categories"
    ON public.categories FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own categories"
    ON public.categories FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own categories"
    ON public.categories FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- TAGS POLICIES
CREATE POLICY "Users can view own tags"
    ON public.tags FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tags"
    ON public.tags FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tags"
    ON public.tags FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tags"
    ON public.tags FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- VAULTS POLICIES
CREATE POLICY "Users can view own vaults"
    ON public.vaults FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own vaults"
    ON public.vaults FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own vaults"
    ON public.vaults FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own vaults"
    ON public.vaults FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- VAULT ITEMS POLICIES
CREATE POLICY "Users can view own vault items"
    ON public.vault_items FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own vault items"
    ON public.vault_items FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own vault items"
    ON public.vault_items FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own vault items"
    ON public.vault_items FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- VAULT ITEM TAGS POLICIES
CREATE POLICY "Users can view own vault item tags"
    ON public.vault_item_tags FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.vault_items
            WHERE vault_items.id = vault_item_tags.vault_item_id
            AND vault_items.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create own vault item tags"
    ON public.vault_item_tags FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.vault_items
            WHERE vault_items.id = vault_item_tags.vault_item_id
            AND vault_items.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own vault item tags"
    ON public.vault_item_tags FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.vault_items
            WHERE vault_items.id = vault_item_tags.vault_item_id
            AND vault_items.user_id = auth.uid()
        )
    );

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================
CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_categories_user_id ON public.categories(user_id);
CREATE INDEX idx_tags_user_id ON public.tags(user_id);
CREATE INDEX idx_vaults_user_id ON public.vaults(user_id);
CREATE INDEX idx_vault_items_user_id ON public.vault_items(user_id);
CREATE INDEX idx_vault_items_vault_id ON public.vault_items(vault_id);
CREATE INDEX idx_vault_items_category_id ON public.vault_items(category_id);
CREATE INDEX idx_vault_items_is_favorite ON public.vault_items(is_favorite) WHERE is_favorite = TRUE;
CREATE INDEX idx_vault_item_tags_vault_item_id ON public.vault_item_tags(vault_item_id);
CREATE INDEX idx_vault_item_tags_tag_id ON public.vault_item_tags(tag_id);