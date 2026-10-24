"use client";

import { useMemo, type MouseEvent } from "react";
import { type Note } from "@/lib/notes";
import { buildUserActions } from "@/lib/user-actions";
import RecentProgressView from "./recent-progress-view";
import UserActionsView from "./user-actions-view";
import { useUiLocale } from "./ui-locale";
import "./styles/progress-workspace.css";

export type ProgressWorkspaceView = "activity" | "actions";
export type ProgressWorkspaceProps = {
  notes: Note[];
  today: string;
  view: ProgressWorkspaceView;
  actionsLoading: boolean;
  activityLoading: boolean;
  actionsFetchedAt: number | null;
  activityFetchedAt: number | null;
  activityError?: string | null;
  onNavigate: (view: ProgressWorkspaceView) => void;
  onOpen: (note: Note) => void;
  onNoteWritten: (note: Note) => void;
};

export default function ProgressWorkspace({ notes, today, view, actionsLoading, activityLoading, actionsFetchedAt, activityFetchedAt, activityError, onNavigate, onOpen, onNoteWritten }: ProgressWorkspaceProps) {
  const { locale } = useUiLocale();
  const ja = locale === "ja";
  const currentCount = useMemo(() => buildUserActions(notes, today).current.length, [notes, today]);
  const actionsLoaded = (actionsFetchedAt !== null && Number.isFinite(actionsFetchedAt))
    || (activityFetchedAt !== null && Number.isFinite(activityFetchedAt));
  const tabs = [
    { view: "activity" as const, title: ja ? "企業の動き" : "企业动态" },
    { view: "actions" as const, title: ja ? "事項の記録" : "事项记录" },
  ];
  const navigate = (event: MouseEvent<HTMLAnchorElement>, next: ProgressWorkspaceView) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(next);
  };
  const openSource = (path: string) => {
    const matches = notes.filter((note) => note.path === path);
    if (matches.length === 1) onOpen(matches[0]);
  };

  return <section className="progress-workspace" aria-labelledby="progress-workspace-title">
    <header className="progress-workspace-header">
      <div><h1 id="progress-workspace-title">{ja ? "最近の進展" : "最近进展"}</h1><p>{ja ? "選考の動きと、必要な対応をひとつの場所に。" : "企业动态与待处理事项，放在一起看。"}</p></div>
      <nav className="progress-workspace-tabs" aria-label={ja ? "進展と事項の記録" : "进展与事项记录"}>
        {tabs.map((tab) => <a key={tab.view} href={`/${tab.view}`} aria-current={view === tab.view ? "page" : undefined} onClick={(event) => navigate(event, tab.view)}>{tab.title}{tab.view === "actions" && actionsLoaded && currentCount > 0 && <span className="progress-workspace-action-count" aria-label={ja ? `現在の本人対応 ${currentCount} 件` : `当前本人动作 ${currentCount} 项`}>{currentCount}</span>}</a>)}
      </nav>
    </header>
    {view === "activity" ? <RecentProgressView notes={notes} today={today} loading={activityLoading} fetchedAt={activityFetchedAt} error={activityError} onOpenSource={openSource} embedded />
      : <UserActionsView notes={notes} today={today} loading={actionsLoading} fetchedAt={actionsFetchedAt} onOpen={onOpen} onNoteWritten={onNoteWritten} embedded />}
  </section>;
}
