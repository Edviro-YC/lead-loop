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
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      follow_up_rules: {
        Row: {
          condition: string
          created_at: string
          delay_days: number
          id: string
          status: string
          template_id: string | null
          thread_id: string
          user_id: string
        }
        Insert: {
          condition?: string
          created_at?: string
          delay_days?: number
          id?: string
          status?: string
          template_id?: string | null
          thread_id: string
          user_id: string
        }
        Update: {
          condition?: string
          created_at?: string
          delay_days?: number
          id?: string
          status?: string
          template_id?: string | null
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "follow_up_rules_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_rules_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "watched_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "follow_up_rules_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          company: string | null
          created_at: string
          custom_fields: Json
          email: string
          id: string
          name: string | null
          source: string
          status: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          custom_fields?: Json
          email: string
          id?: string
          name?: string | null
          source?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          company?: string | null
          created_at?: string
          custom_fields?: Json
          email?: string
          id?: string
          name?: string | null
          source?: string
          status?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outreach_examples: {
        Row: {
          body: string
          context: string
          created_at: string
          embedding: string | null
          id: string
          outcome: string | null
          subject: string | null
          tags: string[] | null
          user_id: string
        }
        Insert: {
          body: string
          context: string
          created_at?: string
          embedding?: string | null
          id?: string
          outcome?: string | null
          subject?: string | null
          tags?: string[] | null
          user_id: string
        }
        Update: {
          body?: string
          context?: string
          created_at?: string
          embedding?: string | null
          id?: string
          outcome?: string | null
          subject?: string | null
          tags?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "outreach_examples_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          gmail_email: string | null
          gmail_refresh_token: string | null
          gmail_token_expires_at: string | null
          id: string
          settings: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          gmail_email?: string | null
          gmail_refresh_token?: string | null
          gmail_token_expires_at?: string | null
          id: string
          settings?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          gmail_email?: string | null
          gmail_refresh_token?: string | null
          gmail_token_expires_at?: string | null
          id?: string
          settings?: Json
          updated_at?: string
        }
        Relationships: []
      }
      scheduled_follow_ups: {
        Row: {
          acted_at: string | null
          created_at: string
          draft_gmail_id: string | null
          generated_body: string | null
          id: string
          rule_id: string
          scheduled_for: string
          status: string
          thread_id: string
          user_id: string
        }
        Insert: {
          acted_at?: string | null
          created_at?: string
          draft_gmail_id?: string | null
          generated_body?: string | null
          id?: string
          rule_id: string
          scheduled_for: string
          status?: string
          thread_id: string
          user_id: string
        }
        Update: {
          acted_at?: string | null
          created_at?: string
          draft_gmail_id?: string | null
          generated_body?: string | null
          id?: string
          rule_id?: string
          scheduled_for?: string
          status?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_follow_ups_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "follow_up_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "watched_threads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_follow_ups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          body: string
          category: string | null
          created_at: string
          id: string
          is_active: boolean
          name: string
          subject: string | null
          updated_at: string
          user_id: string
          variables: string[] | null
        }
        Insert: {
          body: string
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          subject?: string | null
          updated_at?: string
          user_id: string
          variables?: string[] | null
        }
        Update: {
          body?: string
          category?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          subject?: string | null
          updated_at?: string
          user_id?: string
          variables?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "templates_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      thread_messages: {
        Row: {
          body_text: string | null
          direction: string
          from_email: string | null
          gmail_message_id: string
          id: string
          sent_at: string | null
          snippet: string | null
          subject: string | null
          synced_at: string
          thread_id: string
          to_email: string | null
        }
        Insert: {
          body_text?: string | null
          direction: string
          from_email?: string | null
          gmail_message_id: string
          id?: string
          sent_at?: string | null
          snippet?: string | null
          subject?: string | null
          synced_at?: string
          thread_id: string
          to_email?: string | null
        }
        Update: {
          body_text?: string | null
          direction?: string
          from_email?: string | null
          gmail_message_id?: string
          id?: string
          sent_at?: string | null
          snippet?: string | null
          subject?: string | null
          synced_at?: string
          thread_id?: string
          to_email?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "thread_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "watched_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      watched_threads: {
        Row: {
          created_at: string
          gmail_thread_id: string
          id: string
          last_activity_at: string | null
          last_gmail_history_id: string | null
          last_synced_at: string | null
          lead_id: string | null
          status: string
          subject: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          gmail_thread_id: string
          id?: string
          last_activity_at?: string | null
          last_gmail_history_id?: string | null
          last_synced_at?: string | null
          lead_id?: string | null
          status?: string
          subject?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          gmail_thread_id?: string
          id?: string
          last_activity_at?: string | null
          last_gmail_history_id?: string | null
          last_synced_at?: string | null
          lead_id?: string | null
          status?: string
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watched_threads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "watched_threads_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
