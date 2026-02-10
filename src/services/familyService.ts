import { supabase } from '@/integrations/supabase/client';

export interface FamilyMember {
  id: string;
  family_owner_id: string;
  member_email: string;
  member_user_id: string | null;
  role: string;
  status: string;
  invited_at: string;
  joined_at: string | null;
}

export interface SharedCollection {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export async function getFamilyMembers(ownerId: string): Promise<FamilyMember[]> {
  const { data, error } = await supabase
    .from('family_members')
    .select('*')
    .eq('family_owner_id', ownerId)
    .order('invited_at', { ascending: false });

  if (error) throw error;
  return (data || []) as FamilyMember[];
}

export async function inviteFamilyMember(ownerId: string, email: string): Promise<void> {
  const { error } = await supabase
    .from('family_members')
    .insert({
      family_owner_id: ownerId,
      member_email: email,
      status: 'invited',
      role: 'member',
    });

  if (error) throw error;
}

export async function removeFamilyMember(id: string): Promise<void> {
  const { error } = await supabase.from('family_members').delete().eq('id', id);
  if (error) throw error;
}

export async function getSharedCollections(ownerId: string): Promise<SharedCollection[]> {
  const { data, error } = await supabase
    .from('shared_collections')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data || []) as SharedCollection[];
}

export async function createSharedCollection(ownerId: string, name: string, description?: string): Promise<void> {
  const { error } = await supabase
    .from('shared_collections')
    .insert({ owner_id: ownerId, name, description: description || null });

  if (error) throw error;
}

export async function deleteSharedCollection(id: string): Promise<void> {
  const { error } = await supabase.from('shared_collections').delete().eq('id', id);
  if (error) throw error;
}
