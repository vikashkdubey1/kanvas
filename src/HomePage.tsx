import React from 'react';
//import styles from './HomePage.module.css';

interface Project {
    id: string;
    title: string;
    edited: string;
}

const styles = require('./HomePage.module.css') as { [key: string]: string };

console.log('styles from HomePage.module.css:', styles);

const projects: Project[] = [
    { id: '1', title: 'portfolio', edited: 'Edited 2 days ago' },
    { id: '2', title: 'JD Business_App - Page 1', edited: 'Edited 5 days ago' },
    { id: '3', title: 'landing page redesign', edited: 'Edited 7 days ago' },
    { id: '4', title: 'illustrations pack', edited: 'Edited 10 days ago' },
    { id: '5', title: 'mobile ui kit', edited: 'Edited 14 days ago' },
    { id: '6', title: 'components library', edited: 'Edited 16 days ago' },
];

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

const ProjectCard: React.FC<Project> = ({ title, edited }) => {
    return (
        <div className={styles.projectCard}>
            <div className={styles.thumbnail} />
            <div className={styles.projectTitle}>{title}</div>
            <div className={styles.projectMeta}>{edited}</div>
        </div>
    );
};

const ProjectGrid: React.FC = () => {
    return (
        <div className={styles.projectGrid}>
            {projects.map((project) => (
                <ProjectCard key={project.id} {...project} />
            ))}
        </div>
    );
};

const HomePage: React.FC = () => {
    console.log('styles from HomePage.module.css:', styles);
    return (
        <div className={styles.layout}>
            <Sidebar />
            <div className={styles.mainArea}>
                <TopBar />
                <main className={styles.content}>
                    <div>
                        <div className={styles.heading}>Recents</div>
                        <div className={styles.subheading}>Describe your idea and make it come to life</div>
                    </div>

                    <div className={styles.tabs}>
                        <span className={`${styles.tab} ${styles.tabActive}`}>Recently viewed</span>
                        <span className={styles.tab}>Shared files</span>
                        <span className={styles.tab}>Shared projects</span>
                    </div>

                    <ProjectGrid />
                </main>
            </div>
        </div>
    );
};

export default HomePage;
