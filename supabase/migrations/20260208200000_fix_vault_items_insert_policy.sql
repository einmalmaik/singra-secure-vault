-- Fix vault_items INSERT policy to also check vault ownership
-- Prevents 400 Bad Request when user tries to insert items with vault_id they don't own

-- Drop old policy that only checked user_id
DROP POLICY IF EXISTS "Users can create own vault items" ON public.vault_items;

-- Create new policy that also verifies the user owns the vault
CREATE POLICY "Users can create own vault items"
    ON public.vault_items FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = user_id
        AND EXISTS (
            SELECT 1 FROM public.vaults
            WHERE vaults.id = vault_items.vault_id
            AND vaults.user_id = auth.uid()
        )
    );
