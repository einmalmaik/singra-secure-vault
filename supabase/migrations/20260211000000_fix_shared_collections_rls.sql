-- ============================================
-- Fix shared_collections RLS Policy
-- Removes potential recursion in SELECT policy
-- ============================================

-- Drop existing policy
DROP POLICY IF EXISTS "Users can view own or shared collections" ON public.shared_collections;

-- Create simplified policy without recursion
-- Users can see collections they own OR collections where they are explicitly a member
CREATE POLICY "Users can view own or shared collections"
    ON public.shared_collections FOR SELECT
    TO authenticated
    USING (
        owner_id = auth.uid() OR
        id IN (
            SELECT collection_id 
            FROM public.shared_collection_members 
            WHERE user_id = auth.uid()
        )
    );

-- Add comment for documentation
COMMENT ON POLICY "Users can view own or shared collections" ON public.shared_collections IS 
'Allows users to view collections they own or are members of. Uses IN subquery to avoid recursion.';
