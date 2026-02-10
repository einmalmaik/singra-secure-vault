import { supabase } from "@/integrations/supabase/client";

export interface EmergencyAccess {
    id: string;
    grantor_id: string;
    trusted_email: string;
    trusted_user_id: string | null;
    status: 'invited' | 'accepted' | 'pending' | 'granted' | 'rejected' | 'expired' | 'revoked';
    wait_days: number;
    requested_at: string | null;
    granted_at: string | null;
    created_at: string;
    trustee_public_key: string | null;
    encrypted_master_key: string | null;
    grantor?: {
        display_name: string | null;
        avatar_url: string | null;
    };
    trustee?: {
        display_name: string | null;
        avatar_url: string | null;
    };
}

export const emergencyAccessService = {
    // Get people who I trust (I am the grantor)
    async getTrustees() {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) return [];

        const { data, error } = await supabase
            .from('emergency_access')
            .select(`
                *,
                trustee:profiles!emergency_access_trusted_user_id_fkey(
                    display_name,
                    avatar_url
                )
            `)
            .eq('grantor_id', userData.user.id)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data as unknown as EmergencyAccess[];
    },

    // Get people who trust me (I am the trustee)
    async getGrantors() {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user?.email) return [];

        const { data, error } = await supabase
            .from('emergency_access')
            .select(`
                *,
                grantor:profiles!emergency_access_grantor_id_fkey(
                    display_name,
                    avatar_url
                )
            `)
            .or(`trusted_user_id.eq.${userData.user.id},trusted_email.eq.${userData.user.email}`)
            .order('created_at', { ascending: false });

        if (error) throw error;
        return data as unknown as EmergencyAccess[];
    },

    // Invite someone to be my trustee
    async inviteTrustee(email: string, waitDays: number) {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error("Not authenticated");

        const { data, error } = await supabase
            .from('emergency_access')
            .insert({
                grantor_id: userData.user.id,
                trusted_email: email,
                wait_days: waitDays,
                status: 'invited'
            })
            .select()
            .single();

        if (error) throw error;
        return data as unknown as EmergencyAccess;
    },

    // Revoke access (delete invite or remove trustee)
    async revokeAccess(id: string) {
        const { error } = await supabase
            .from('emergency_access')
            .delete()
            .eq('id', id);

        if (error) throw error;
    },

    // Accept an invitation (as trustee)
    async acceptInvite(accessId: string, publicKeyJwk: string) {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) throw new Error("Not authenticated");

        const { data, error } = await supabase
            .from('emergency_access')
            .update({
                status: 'accepted',
                trusted_user_id: userData.user.id,
                trustee_public_key: publicKeyJwk
            })
            .eq('id', accessId)
            .select()
            .single();

        if (error) throw error;
        return data as unknown as EmergencyAccess;
    },

    // Update encrypted master key (as grantor, after trustee accepts)
    async setEncryptedMasterKey(accessId: string, encryptedKey: string) {
        const { error } = await supabase
            .from('emergency_access')
            .update({
                encrypted_master_key: encryptedKey,
                updated_at: new Date().toISOString()
            })
            .eq('id', accessId);

        if (error) throw error;
    },

    // Request access (as trustee) - starts the timer
    async requestAccess(accessId: string) {
        const { data, error } = await supabase
            .from('emergency_access')
            .update({
                status: 'pending',
                requested_at: new Date().toISOString()
            })
            .eq('id', accessId)
            .select()
            .single();

        if (error) throw error;
        return data as unknown as EmergencyAccess;
    },

    // Reject access request (as grantor)
    async rejectAccess(accessId: string) {
        const { data, error } = await supabase
            .from('emergency_access')
            .update({
                status: 'accepted',
                requested_at: null
            })
            .eq('id', accessId)
            .select()
            .single();

        if (error) throw error;
        return data as unknown as EmergencyAccess;
    },

    // Grant access immediately (as grantor)
    async approveAccess(accessId: string) {
        const { data, error } = await supabase
            .from('emergency_access')
            .update({
                status: 'granted',
                granted_at: new Date().toISOString()
            })
            .eq('id', accessId)
            .select()
            .single();

        if (error) throw error;
        return data as unknown as EmergencyAccess;
    }
};
