"use client";

import { useState } from "react";
import { Phone, CheckCircle, MessageSquare, ExternalLink, MapPin, Mail } from "lucide-react";

type Lead = {
  id: string;
  fullName: string;
  primaryPhone: string;
  email: string | null;
  propertyAddress1: string;
  city: string;
  state: string;
  currentStage: { name: string };
  services: { serviceCategory: { name: string } }[];
  notesSummary: string | null;
  createdAt: string;
};

type LinkMap = Record<string, { token: string; clicked: boolean }>;

export function ActionPanel({
  lead,
  linkMap,
  currentToken,
}: {
  lead: Lead;
  linkMap: LinkMap;
  currentToken: string;
}) {
  const [actionStates, setActionStates] = useState<Record<string, boolean>>({});

  async function handleAction(actionType: string) {
    const link = linkMap[actionType];
    if (!link) return;

    try {
      await fetch(`/api/track/${link.token}`);
      setActionStates((prev) => ({ ...prev, [actionType]: true }));
    } catch {
      // Still mark locally
      setActionStates((prev) => ({ ...prev, [actionType]: true }));
    }
  }

  const isActioned = (type: string) => actionStates[type] || linkMap[type]?.clicked;
  const services = lead.services.map((s) => s.serviceCategory.name).join(", ") || "General";

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      {/* Header */}
      <div className="bg-blue-600 text-white rounded-xl p-4">
        <div className="text-xs uppercase tracking-wider opacity-80 mb-1">New Google Ads Lead</div>
        <h1 className="text-xl font-bold">{lead.fullName}</h1>
        <div className="flex items-center gap-2 mt-2 text-blue-100 text-sm">
          <MapPin className="h-3.5 w-3.5" />
          {lead.city}, {lead.state}
        </div>
        <div className="mt-1 text-blue-100 text-sm">{services}</div>
      </div>

      {/* Contact Info */}
      <div className="bg-white rounded-xl p-4 shadow-sm space-y-3">
        <a
          href={`tel:${lead.primaryPhone}`}
          className="flex items-center gap-3 p-3 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
          onClick={() => handleAction("START_CALL")}
        >
          <div className="bg-green-500 text-white rounded-full p-2">
            <Phone className="h-5 w-5" />
          </div>
          <div>
            <div className="font-medium text-green-800">Call Now</div>
            <div className="text-sm text-green-600">{lead.primaryPhone}</div>
          </div>
        </a>

        {lead.email && (
          <a href={`mailto:${lead.email}`} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            <Mail className="h-5 w-5 text-gray-500" />
            <span className="text-sm">{lead.email}</span>
          </a>
        )}

        {lead.notesSummary && (
          <div className="p-3 bg-yellow-50 rounded-lg">
            <div className="text-xs font-medium text-yellow-800 mb-1">Notes</div>
            <p className="text-sm text-yellow-700">{lead.notesSummary}</p>
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl p-4 shadow-sm space-y-2">
        <h2 className="text-sm font-medium text-gray-500 mb-3">Quick Actions</h2>

        <ActionButton
          label="Acknowledge"
          description="I see this lead"
          icon={<CheckCircle className="h-5 w-5" />}
          done={isActioned("ACKNOWLEDGE")}
          onClick={() => handleAction("ACKNOWLEDGE")}
          color="blue"
        />

        <ActionButton
          label="Start Call"
          description="I'm calling now"
          icon={<Phone className="h-5 w-5" />}
          done={isActioned("START_CALL")}
          onClick={() => {
            handleAction("START_CALL");
            window.location.href = `tel:${lead.primaryPhone}`;
          }}
          color="green"
        />

        <ActionButton
          label="Mark Attempted"
          description="Called, no answer"
          icon={<MessageSquare className="h-5 w-5" />}
          done={isActioned("MARK_ATTEMPTED")}
          onClick={() => handleAction("MARK_ATTEMPTED")}
          color="amber"
        />

        <ActionButton
          label="Mark Contacted"
          description="Spoke with lead"
          icon={<CheckCircle className="h-5 w-5" />}
          done={isActioned("MARK_CONTACTED")}
          onClick={() => handleAction("MARK_CONTACTED")}
          color="emerald"
        />
      </div>

      {/* Deep Link */}
      <a
        href={`/leads/${lead.id}`}
        className="flex items-center justify-center gap-2 p-3 bg-gray-800 text-white rounded-xl text-sm font-medium hover:bg-gray-700 transition-colors"
      >
        <ExternalLink className="h-4 w-4" />
        Open Full Lead in CRM
      </a>
    </div>
  );
}

function ActionButton({
  label,
  description,
  icon,
  done,
  onClick,
  color,
}: {
  label: string;
  description: string;
  icon: React.ReactNode;
  done?: boolean;
  onClick: () => void;
  color: string;
}) {
  const colorClasses: Record<string, { bg: string; text: string; done: string }> = {
    blue: { bg: "bg-blue-50 hover:bg-blue-100", text: "text-blue-700", done: "bg-blue-100 border-blue-300" },
    green: { bg: "bg-green-50 hover:bg-green-100", text: "text-green-700", done: "bg-green-100 border-green-300" },
    amber: { bg: "bg-amber-50 hover:bg-amber-100", text: "text-amber-700", done: "bg-amber-100 border-amber-300" },
    emerald: { bg: "bg-emerald-50 hover:bg-emerald-100", text: "text-emerald-700", done: "bg-emerald-100 border-emerald-300" },
  };
  const c = colorClasses[color] || colorClasses.blue;

  return (
    <button
      onClick={onClick}
      disabled={done}
      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
        done ? `${c.done} border opacity-70` : `${c.bg} border-transparent`
      }`}
    >
      <div className={c.text}>{icon}</div>
      <div className="text-left flex-1">
        <div className={`font-medium text-sm ${c.text}`}>{label}</div>
        <div className="text-xs text-gray-500">{description}</div>
      </div>
      {done && <CheckCircle className="h-4 w-4 text-green-500" />}
    </button>
  );
}
