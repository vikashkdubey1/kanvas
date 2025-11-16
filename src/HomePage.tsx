import React from 'react';
//import styles from './HomePage.module.css';

export interface ProjectSummary {
    id: string;
    title: string;
    edited: string;
}

const styles = require('./HomePage.module.css') as { [key: string]: string };

console.log('styles from HomePage.module.css:', styles);

interface HomePageProps {
    projects: ProjectSummary[];
    onCreateFile?: (project: ProjectSummary) => void;
    selectedProjectId?: string | null;
    detailProject?: ProjectSummary | null;
    onCreateProject: () => void;
    onSelectProject: (project: ProjectSummary) => void;
    onOpenDetails: (project: ProjectSummary) => void;
    onCloseDetails: () => void;
}

const Sidebar: React.FC = () => {
    return (
        <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
                <div className={styles.avatar}>VD</div>
                <div className={styles.userName}>Vikash Dubey</div>
            </div>

            <div className={styles.navSection}>
                <div className={styles.navList}>
                    <div className={styles.navItem}>Recents</div>
                    <div className={styles.navItem}>Community</div>
                </div>
            </div>

            <div className={styles.navSection}>
                <div className={styles.navTitle}>Team</div>
                <div className={styles.teamHeader}>
                    <span className={styles.teamName}>Deepak All team</span>
                    <span className={styles.dropdownIcon}>▾</span>
                </div>
                <div className={styles.navList}>
                    <div className={styles.navItem}>Drafts</div>
                    <div className={styles.navItem}>All projects</div>
                    <div className={styles.navItem}>Resources</div>
                    <div className={styles.navItem}>Trash</div>
                </div>
            </div>

            <div className={styles.navSection}>
                <div className={styles.navTitle}>Starred</div>
                <div className={styles.navList}>
                    <div className={styles.navItem}>Learning</div>
                </div>
            </div>

            <div className={styles.infoCard}>
                <div className={styles.infoText}>You’re almost out of free files.</div>
                <button className={styles.infoButton}>View plans</button>
            </div>
        </aside>
    );
};

const TopBar: React.FC = () => {
    return (
        <header className={styles.topBar}>
            <div className={styles.topBrand}>kanvas</div>
            <nav className={styles.topTabs}>
                <span className={styles.topTab}>Design</span>
                <span className={styles.topTab}>FigJam</span>
                <span className={styles.topTab}>Slides</span>
                <span className={styles.topTab}>Site</span>
            </nav>
            <div className={styles.searchWrap}>
                <input className={styles.searchInput} placeholder="Search files" />
            </div>
            <div className={styles.topRight}>
                <span className={styles.iconButton} aria-label="Notifications">
                    🔔
                </span>
                <div className={styles.avatarSmall}>VD</div>
            </div>
        </header>
    );
};

interface ProjectCardProps extends ProjectSummary {
    selected?: boolean;
    onClick?: () => void;
    onDoubleClick?: () => void;
}

const ProjectCard: React.FC<ProjectCardProps> = ({ title, edited, selected, onClick, onDoubleClick }) => {
    return (
        <div
            className={`${styles.projectCard} ${selected ? styles.projectCardSelected : ''}`.trim()}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onClick?.();
                }
            }}
        >
            <div className={styles.thumbnail} />
            <div className={styles.projectTitle}>{title}</div>
            <div className={styles.projectMeta}>{edited}</div>
        </div>
    );
};

interface ProjectGridProps {
    projects: ProjectSummary[];
    selectedId: string | null;
    onSelect: (project: ProjectSummary) => void;
    onOpenDetails: (project: ProjectSummary) => void;
}

const ProjectGrid: React.FC<ProjectGridProps> = ({ projects, selectedId, onSelect, onOpenDetails }) => {
    return (
        <div className={styles.projectGrid}>
            {projects.map((project) => (
                <ProjectCard
                    key={project.id}
                    {...project}
                    selected={project.id === selectedId}
                    onClick={() => onSelect(project)}
                    onDoubleClick={() => onOpenDetails(project)}
                />
            ))}
        </div>
    );
};

const HomePage: React.FC<HomePageProps> = ({
    projects,
    selectedProjectId = null,
    detailProject = null,
    onCreateFile,
    onCreateProject,
    onSelectProject,
    onOpenDetails,
    onCloseDetails,
}) => {
    const handleCreateFile = () => {
        if (detailProject) {
            onCreateFile?.(detailProject);
        }
    };

    console.log('styles from HomePage.module.css:', styles);
    return (
        <div className={styles.layout}>
            <Sidebar />
            <div className={styles.mainArea}>
                <TopBar />
                <main className={styles.content}>
                    <div className={styles.headerRow}>
                        <div>
                            <div className={styles.heading}>Recents</div>
                            <div className={styles.subheading}>Describe your idea and make it come to life</div>
                        </div>
                        <button className={styles.primaryButton} onClick={onCreateProject}>
                            + New project
                        </button>
                    </div>

                    <div className={styles.tabs}>
                        <span className={`${styles.tab} ${styles.tabActive}`}>Recently viewed</span>
                        <span className={styles.tab}>Shared files</span>
                        <span className={styles.tab}>Shared projects</span>
                    </div>

                    {detailProject && (
                        <div className={styles.detailPanel}>
                            <div className={styles.detailHeader}>
                                <div>
                                    <div className={styles.detailTitle}>{detailProject.title}</div>
                                    <div className={styles.detailMeta}>{detailProject.edited}</div>
                                </div>
                                <button className={styles.secondaryButton} onClick={onCloseDetails}>
                                    Close
                                </button>
                            </div>
                            <div className={styles.detailBody}>
                                <p className={styles.detailCopy}>Add files to your project to start designing.</p>
                                <div className={styles.detailActions}>
                                    <button className={styles.primaryButton} onClick={handleCreateFile}>
                                        Create file
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <ProjectGrid
                        projects={projects}
                        selectedId={selectedProjectId ?? null}
                        onSelect={onSelectProject}
                        onOpenDetails={onOpenDetails}
                    />
                    {!projects.length && (
                        <div className={styles.emptyState}>Start by creating a new project to see it here.</div>
                    )}
                </main>
            </div>
        </div>
    );
};

export default HomePage;
