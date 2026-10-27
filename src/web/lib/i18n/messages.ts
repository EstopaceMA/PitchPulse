import type { Language } from "@/lib/match/types";
import en from "@/messages/en.json";
import fil from "@/messages/fil.json";
import es from "@/messages/es.json";
import ptBR from "@/messages/pt-BR.json";
import id from "@/messages/id.json";
import ar from "@/messages/ar.json";
import th from "@/messages/th.json";

export const messages: Record<Language, Record<string, string>> = { en, fil, es, "pt-BR": ptBR, id, ar, th };
