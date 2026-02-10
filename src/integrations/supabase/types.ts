export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      backup_codes: {
        Row: {
          code_hash: string
          created_at: string | null
          id: string
          is_used: boolean | null
          used_at: string | null
          user_id: string
        }
        Insert: {
          code_hash: string
          created_at?: string | null
          id?: string
          is_used?: boolean | null
          used_at?: string | null
          user_id: string
        }
        Update: {
          code_hash?: string
          created_at?: string | null
          id?: string
          is_used?: boolean | null
          used_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          color: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
          parent_id: string | null
          sort_order: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          sort_order?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_access: {
        Row: {
          created_at: string
          granted_at: string | null
          grantor_id: string
          id: string
          requested_at: string | null
          status: string
          trusted_email: string
          trusted_user_id: string | null
          updated_at: string
          wait_days: number
        }
        Insert: {
          created_at?: string
          granted_at?: string | null
          grantor_id: string
          id?: string
          requested_at?: string | null
          status?: string
          trusted_email: string
          trusted_user_id?: string | null
          updated_at?: string
          wait_days?: number
        }
        Update: {
          created_at?: string
          granted_at?: string | null
          grantor_id?: string
          id?: string
          requested_at?: string | null
          status?: string
          trusted_email?: string
          trusted_user_id?: string | null
          updated_at?: string
          wait_days?: number
        }
        Relationships: []
      }
      family_members: {
        Row: {
          family_owner_id: string
          id: string
          invited_at: string
          joined_at: string | null
          member_email: string
          member_user_id: string | null
          role: string
          status: string
        }
        Insert: {
          family_owner_id: string
          id?: string
          invited_at?: string
          joined_at?: string | null
          member_email: string
          member_user_id?: string | null
          role?: string
          status?: string
        }
        Update: {
          family_owner_id?: string
          id?: string
          invited_at?: string
          joined_at?: string | null
          member_email?: string
          member_user_id?: string | null
          role?: string
          status?: string
        }
        Relationships: []
      }
      file_attachments: {
        Row: {
          created_at: string
          encrypted: boolean | null
          file_name: string
          file_size: number
          id: string
          mime_type: string | null
          storage_path: string
          updated_at: string
          user_id: string
          vault_item_id: string
        }
        Insert: {
          created_at?: string
          encrypted?: boolean | null
          file_name: string
          file_size: number
          id?: string
          mime_type?: string | null
          storage_path: string
          updated_at?: string
          user_id: string
          vault_item_id: string
        }
        Update: {
          created_at?: string
          encrypted?: boolean | null
          file_name?: string
          file_size?: number
          id?: string
          mime_type?: string | null
          storage_path?: string
          updated_at?: string
          user_id?: string
          vault_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "file_attachments_vault_item_id_fkey"
            columns: ["vault_item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          encryption_salt: string | null
          hide_community_ads: boolean | null
          id: string
          master_password_verifier: string | null
          preferred_language: string | null
          theme: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          encryption_salt?: string | null
          hide_community_ads?: boolean | null
          id?: string
          master_password_verifier?: string | null
          preferred_language?: string | null
          theme?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          encryption_salt?: string | null
          hide_community_ads?: boolean | null
          id?: string
          master_password_verifier?: string | null
          preferred_language?: string | null
          theme?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      shared_collection_items: {
        Row: {
          added_by: string | null
          collection_id: string
          created_at: string
          id: string
          vault_item_id: string
        }
        Insert: {
          added_by?: string | null
          collection_id: string
          created_at?: string
          id?: string
          vault_item_id: string
        }
        Update: {
          added_by?: string | null
          collection_id?: string
          created_at?: string
          id?: string
          vault_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_collection_items_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "shared_collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shared_collection_items_vault_item_id_fkey"
            columns: ["vault_item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_collection_members: {
        Row: {
          collection_id: string
          created_at: string
          id: string
          permission: string
          user_id: string
        }
        Insert: {
          collection_id: string
          created_at?: string
          id?: string
          permission?: string
          user_id: string
        }
        Update: {
          collection_id?: string
          created_at?: string
          id?: string
          permission?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_collection_members_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "shared_collections"
            referencedColumns: ["id"]
          },
        ]
      }
      shared_collections: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          owner_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          owner_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean | null
          created_at: string | null
          current_period_end: string | null
          has_used_intro_discount: boolean | null
          id: string
          status: string | null
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          tier: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          has_used_intro_discount?: boolean | null
          id?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          current_period_end?: string | null
          has_used_intro_discount?: boolean | null
          id?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          color: string | null
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string | null
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      user_2fa: {
        Row: {
          created_at: string | null
          enabled_at: string | null
          id: string
          is_enabled: boolean | null
          last_verified_at: string | null
          totp_secret: string | null
          totp_secret_enc: string | null
          updated_at: string | null
          user_id: string
          vault_2fa_enabled: boolean | null
        }
        Insert: {
          created_at?: string | null
          enabled_at?: string | null
          id?: string
          is_enabled?: boolean | null
          last_verified_at?: string | null
          totp_secret?: string | null
          totp_secret_enc?: string | null
          updated_at?: string | null
          user_id: string
          vault_2fa_enabled?: boolean | null
        }
        Update: {
          created_at?: string | null
          enabled_at?: string | null
          id?: string
          is_enabled?: boolean | null
          last_verified_at?: string | null
          totp_secret?: string | null
          totp_secret_enc?: string | null
          updated_at?: string | null
          user_id?: string
          vault_2fa_enabled?: boolean | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      vault_item_tags: {
        Row: {
          created_at: string
          id: string
          tag_id: string
          vault_item_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tag_id: string
          vault_item_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tag_id?: string
          vault_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vault_item_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_item_tags_vault_item_id_fkey"
            columns: ["vault_item_id"]
            isOneToOne: false
            referencedRelation: "vault_items"
            referencedColumns: ["id"]
          },
        ]
      }
      vault_items: {
        Row: {
          category_id: string | null
          created_at: string
          encrypted_data: string
          icon_url: string | null
          id: string
          is_favorite: boolean | null
          item_type: Database["public"]["Enums"]["vault_item_type"]
          last_used_at: string | null
          sort_order: number | null
          title: string
          updated_at: string
          user_id: string
          vault_id: string
          website_url: string | null
        }
        Insert: {
          category_id?: string | null
          created_at?: string
          encrypted_data: string
          icon_url?: string | null
          id?: string
          is_favorite?: boolean | null
          item_type?: Database["public"]["Enums"]["vault_item_type"]
          last_used_at?: string | null
          sort_order?: number | null
          title?: string
          updated_at?: string
          user_id: string
          vault_id: string
          website_url?: string | null
        }
        Update: {
          category_id?: string | null
          created_at?: string
          encrypted_data?: string
          icon_url?: string | null
          id?: string
          is_favorite?: boolean | null
          item_type?: Database["public"]["Enums"]["vault_item_type"]
          last_used_at?: string | null
          sort_order?: number | null
          title?: string
          updated_at?: string
          user_id?: string
          vault_id?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vault_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "vault_items_vault_id_fkey"
            columns: ["vault_id"]
            isOneToOne: false
            referencedRelation: "vaults"
            referencedColumns: ["id"]
          },
        ]
      }
      vaults: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean | null
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean | null
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_my_account: { Args: never; Returns: Json }
      get_totp_encryption_key: { Args: never; Returns: string }
      get_user_2fa_secret: {
        Args: { p_require_enabled?: boolean; p_user_id: string }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      initialize_user_2fa_secret: {
        Args: { p_secret: string; p_user_id: string }
        Returns: undefined
      }
      rotate_totp_encryption_key: {
        Args: { p_new_key: string }
        Returns: number
      }
      user_2fa_decrypt_secret: {
        Args: { _secret_enc: string }
        Returns: string
      }
      user_2fa_encrypt_secret: { Args: { _secret: string }; Returns: string }
    }
    Enums: {
      app_role: "admin" | "moderator" | "user"
      vault_item_type: "password" | "note" | "totp"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "moderator", "user"],
      vault_item_type: ["password", "note", "totp"],
    },
  },
} as const
