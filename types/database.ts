/**
 * Minimal typed surface for the Supabase client.
 * Mirrors supabase/migrations/0001_init.sql.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: {
      departments: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
        };
        Insert: { id?: string; name: string; created_at?: string; updated_at?: string };
        Update: { id?: string; name?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          full_name: string;
          email: string;
          role: string;
          department_id: string | null;
          avatar_url: string | null;
          is_active: boolean;
          is_system: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          email: string;
          role?: string;
          department_id?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          is_system?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          full_name?: string;
          email?: string;
          role?: string;
          department_id?: string | null;
          avatar_url?: string | null;
          is_active?: boolean;
          is_system?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      telegram_links: {
        Row: {
          profile_id: string;
          bot: string;
          chat_id: number;
          linked_at: string;
        };
        Insert: {
          profile_id: string;
          bot: string;
          chat_id: number;
          linked_at?: string;
        };
        Update: {
          profile_id?: string;
          bot?: string;
          chat_id?: number;
          linked_at?: string;
        };
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      tickets: {
        Row: {
          id: string;
          ticket_number: string;
          title: string;
          description: string;
          category_id: string | null;
          priority: string;
          status: string;
          source: string;
          channel_id: string | null;
          created_by: string;
          assigned_to: string | null;
          created_at: string;
          updated_at: string;
          resolved_at: string | null;
          closed_at: string | null;
        };
        Insert: {
          id?: string;
          ticket_number?: string;
          title: string;
          description: string;
          category_id?: string | null;
          priority?: string;
          status?: string;
          source?: string;
          channel_id?: string | null;
          created_by: string;
          assigned_to?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
          closed_at?: string | null;
        };
        Update: {
          id?: string;
          ticket_number?: string;
          title?: string;
          description?: string;
          category_id?: string | null;
          priority?: string;
          status?: string;
          source?: string;
          channel_id?: string | null;
          created_by?: string;
          assigned_to?: string | null;
          created_at?: string;
          updated_at?: string;
          resolved_at?: string | null;
          closed_at?: string | null;
        };
        Relationships: [];
      };
      channels: {
        Row: {
          id: string;
          name: string;
          slug: string;
          public_key: string;
          allowed_origins: string[];
          department_id: string | null;
          default_category_id: string | null;
          default_priority: string;
          greeting: string;
          accent_color: string;
          is_active: boolean;
          system_profile_id: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          public_key: string;
          allowed_origins?: string[];
          department_id?: string | null;
          default_category_id?: string | null;
          default_priority?: string;
          greeting?: string;
          accent_color?: string;
          is_active?: boolean;
          system_profile_id: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          public_key?: string;
          allowed_origins?: string[];
          department_id?: string | null;
          default_category_id?: string | null;
          default_priority?: string;
          greeting?: string;
          accent_color?: string;
          is_active?: boolean;
          system_profile_id?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ticket_contacts: {
        Row: {
          ticket_id: string;
          visitor_ref: string;
          name: string;
          email: string;
          visitor_ip: string | null;
          user_agent: string | null;
          page_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          ticket_id: string;
          visitor_ref: string;
          name: string;
          email: string;
          visitor_ip?: string | null;
          user_agent?: string | null;
          page_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          ticket_id?: string;
          visitor_ref?: string;
          name?: string;
          email?: string;
          visitor_ip?: string | null;
          user_agent?: string | null;
          page_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      widget_sessions: {
        Row: {
          id: string;
          channel_id: string;
          ticket_id: string;
          visitor_ref: string;
          token_hash: string;
          created_at: string;
          expires_at: string;
          last_seen_at: string;
        };
        Insert: {
          id?: string;
          channel_id: string;
          ticket_id: string;
          visitor_ref: string;
          token_hash: string;
          created_at?: string;
          expires_at?: string;
          last_seen_at?: string;
        };
        Update: {
          id?: string;
          channel_id?: string;
          ticket_id?: string;
          visitor_ref?: string;
          token_hash?: string;
          created_at?: string;
          expires_at?: string;
          last_seen_at?: string;
        };
        Relationships: [];
      };
      ticket_comments: {
        Row: {
          id: string;
          ticket_id: string;
          user_id: string;
          message: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          user_id: string;
          message: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          ticket_id?: string;
          user_id?: string;
          message?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      ticket_attachments: {
        Row: {
          id: string;
          ticket_id: string;
          comment_id: string | null;
          uploaded_by: string;
          file_name: string;
          file_path: string;
          file_size: number;
          mime_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          comment_id?: string | null;
          uploaded_by: string;
          file_name: string;
          file_path: string;
          file_size?: number;
          mime_type?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          ticket_id?: string;
          comment_id?: string | null;
          uploaded_by?: string;
          file_name?: string;
          file_path?: string;
          file_size?: number;
          mime_type?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      ticket_history: {
        Row: {
          id: string;
          ticket_id: string;
          user_id: string | null;
          action: string;
          old_value: string | null;
          new_value: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          ticket_id: string;
          user_id?: string | null;
          action: string;
          old_value?: string | null;
          new_value?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          ticket_id?: string;
          user_id?: string | null;
          action?: string;
          old_value?: string | null;
          new_value?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          user_id: string;
          ticket_id: string | null;
          title: string;
          message: string;
          is_read: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          ticket_id?: string | null;
          title: string;
          message: string;
          is_read?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          ticket_id?: string | null;
          title?: string;
          message?: string;
          is_read?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      can_access_ticket: { Args: { p_ticket_id: string }; Returns: boolean };
      ticket_actor_name: { Args: { p_ticket_id: string; p_user_id: string }; Returns: string };
      shares_ticket_with: { Args: { p_user_id: string }; Returns: boolean };
      current_role_name: { Args: Record<string, never>; Returns: string };
      is_staff: { Args: Record<string, never>; Returns: boolean };
      is_admin: { Args: Record<string, never>; Returns: boolean };
      ticket_stats: { Args: Record<string, never>; Returns: Json };
      create_api_key: {
        Args: { p_name: string; p_expires_at?: string | null };
        Returns: Array<{
          id: string;
          name: string;
          api_key: string;
          key_prefix: string;
          expires_at: string | null;
        }>;
      };
      revoke_api_key: { Args: { p_id: string }; Returns: boolean };
      verify_api_key: {
        Args: { p_key: string };
        Returns: Array<{
          user_id: string;
          key_id: string;
          key_name: string;
          role: string;
          email: string;
          full_name: string;
        }>;
      };
      create_telegram_link_code: {
        Args: { p_bot?: string };
        Returns: Array<{ code: string; expires_at: string }>;
      };
      profile_for_telegram_chat: {
        Args: { p_bot: string; p_chat_id: number };
        Returns: Array<{ user_id: string; full_name: string; role: string; email: string }>;
      };
      redeem_telegram_code: {
        Args: { p_code: string; p_bot: string; p_chat_id: number };
        Returns: Array<{ user_id: string; full_name: string; role: string }>;
      };
      unlink_telegram: { Args: { p_bot: string; p_chat_id: number }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
