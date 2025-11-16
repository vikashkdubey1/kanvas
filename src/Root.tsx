import React, { useEffect, useMemo, useRef, useState } from 'react';
import HomePage, { ProjectSummary } from './HomePage';
import App from './App';

const buildProject = (index: number): ProjectSummary => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  title: `Untitled Project ${index}`,
  edited: 'Edited just now',
});

const Root: React.FC = () => {
  const [currentView, setCurrentView] = useState<'home' | 'canvas'>(() => {
    if (typeof window === 'undefined') return 'home';
    return window.location.hash === '#canvas' ? 'canvas' : 'home';
  });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detailProjectId, setDetailProjectId] = useState<string | null>(null);
  const [historyReady, setHistoryReady] = useState(false);
  const historyDirectionRef = useRef<'pop' | null>(null);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId]
  );
  const detailProject = useMemo(
    () => projects.find((project) => project.id === detailProjectId) || null,
    [projects, detailProjectId]
  );

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const initialView = window.location.hash === '#canvas' ? 'canvas' : 'home';
    setCurrentView(initialView);
    window.history.replaceState({ view: initialView }, '', initialView === 'canvas' ? '#canvas' : '#home');
    setHistoryReady(true);

    const handlePopState = (event: PopStateEvent) => {
      const view = event.state?.view === 'canvas' ? 'canvas' : 'home';
      historyDirectionRef.current = 'pop';
      setCurrentView(view);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!historyReady || typeof window === 'undefined') return;
    const url = currentView === 'canvas' ? '#canvas' : '#home';
    if (historyDirectionRef.current === 'pop') {
      historyDirectionRef.current = null;
      window.history.replaceState({ view: currentView }, '', url);
      return;
    }
    window.history.pushState({ view: currentView }, '', url);
  }, [currentView, historyReady]);

  const handleCreateProject = () => {
    const nextIndex = projects.length + 1;
    const project = buildProject(nextIndex);
    setProjects((prev) => [...prev, project]);
    setSelectedProjectId(project.id);
    setDetailProjectId(project.id);
  };

  const handleSelectProject = (project: ProjectSummary) => {
    setSelectedProjectId(project.id);
  };

  const handleOpenDetails = (project: ProjectSummary) => {
    setSelectedProjectId(project.id);
    setDetailProjectId(project.id);
  };

  const handleCloseDetails = () => {
    setDetailProjectId(null);
  };

  const handleCreateFile = (project: ProjectSummary) => {
    setSelectedProjectId(project.id);
    setDetailProjectId(project.id);
    setCurrentView('canvas');
  };

  if (currentView === 'canvas') {
    return <App />;
  }

  return (
    <HomePage
      projects={projects}
      selectedProjectId={selectedProject?.id || null}
      detailProject={detailProject}
      onCreateProject={handleCreateProject}
      onSelectProject={handleSelectProject}
      onOpenDetails={handleOpenDetails}
      onCloseDetails={handleCloseDetails}
      onCreateFile={handleCreateFile}
    />
  );
};

export default Root;
