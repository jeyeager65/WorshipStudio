<script setup lang="ts">
const reports = [
  {
    to: '/reports/song-usage',
    eyebrow: 'Statistics',
    title: 'Song Usage',
    description:
      'Review every song used across completed services for planning, records, and CCLI reporting.',
    icon: 'mdi-music-note-outline',
    color: 'primary',
    detail: 'Date range · Service type · Excel · PDF',
    action: 'Open usage report',
  },
  {
    to: '/reports/planning',
    eyebrow: 'Team Planning',
    title: 'Multi-Week Plan',
    description:
      'Share upcoming songs, sermon details, and team assignments across several weeks at once.',
    icon: 'mdi-calendar-text-outline',
    color: 'teal',
    detail: 'Date range · Assignments · Word · Excel · PDF',
    action: 'Open planning report',
  },
]
</script>

<template>
  <main class="reports-page">
    <header class="reports-hero app-page-hero">
      <div>
        <div class="page-eyebrow">Records &amp; Planning</div>
        <h1>Reports</h1>
        <p>Analyze song usage and share multi-week plans across your services.</p>
      </div>
      <div class="hero-mark" aria-hidden="true">
        <v-icon icon="mdi-file-chart-outline" size="34" />
      </div>
    </header>

    <section class="reports-directory" aria-labelledby="available-reports-heading">
      <div class="section-heading">
        <div>
          <span>Range Reports</span>
          <h2 id="available-reports-heading">Reporting across services</h2>
        </div>
        <p>Choose a report, set its range, then print or save it as a PDF.</p>
      </div>

      <div class="report-grid">
        <router-link v-for="report in reports" :key="report.to" :to="report.to" class="report-card">
          <span class="report-icon" :class="`report-icon--${report.color}`">
            <v-icon :icon="report.icon" size="26" />
          </span>
          <div class="report-copy">
            <span class="report-eyebrow">{{ report.eyebrow }}</span>
            <h3>{{ report.title }}</h3>
            <p>{{ report.description }}</p>
            <span class="report-detail">{{ report.detail }}</span>
          </div>
          <span class="report-action"
            >{{ report.action }} <v-icon icon="mdi-arrow-right" size="17"
          /></span>
        </router-link>
      </div>

      <aside class="report-guidance">
        <span class="guidance-icon"><v-icon icon="mdi-information-outline" size="21" /></span>
        <div>
          <strong>Reports stay connected to your service plans</strong>
          <p>
            There is no separate report data to maintain. Correct a song, assignment, or service
            detail at its source, then reopen the report to see the updated result.
          </p>
        </div>
      </aside>
    </section>
  </main>
</template>

<style scoped>
/* Deliberately NOT on the shared .app-page scroll model (see assets/base.css): this is a
   two-card menu, not a chrome-plus-list screen, so there's no list for a fixed-chrome layout to
   hold still — whole-page scrolling is the right behaviour here, same reasoning as Settings.
   It still shares .app-page-hero so the hero hides on short/narrow screens like everywhere else. */
.reports-page {
  min-height: 100%;
  padding: 24px clamp(24px, 3vw, 48px) 56px;
  background:
    radial-gradient(circle at 78% 0, rgba(var(--v-theme-primary), 0.055), transparent 430px),
    rgb(var(--v-theme-background));
}
.reports-hero,
.reports-directory {
  max-width: 1240px;
  margin-right: auto;
  margin-left: auto;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 11px;
  background: rgba(var(--v-theme-surface), 0.76);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.08);
}
.reports-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 18px;
  padding: 25px 28px 27px;
}
.page-eyebrow,
.report-eyebrow,
.section-heading span {
  color: rgb(var(--v-theme-primary));
  font-size: 0.7rem;
  font-weight: 720;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.reports-hero h1 {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.95);
  font-size: 1.75rem;
  font-weight: 680;
  letter-spacing: -0.025em;
}
.reports-hero p {
  max-width: 620px;
  margin: 8px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.84rem;
}
.hero-mark {
  display: grid;
  width: 58px;
  height: 58px;
  flex: 0 0 58px;
  place-items: center;
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 15px;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
}
.reports-directory {
  padding: 24px;
}
.section-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 28px;
  margin-bottom: 17px;
}
.section-heading h2 {
  margin: 2px 0 0;
  font-size: 1.05rem;
  font-weight: 680;
}
.section-heading p {
  margin: 0;
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-size: 0.74rem;
}
.report-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.report-card {
  display: grid;
  min-height: 246px;
  grid-template-rows: auto 1fr auto;
  padding: 21px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.09);
  border-radius: 10px;
  background: rgba(var(--v-theme-background), 0.3);
  color: inherit;
  text-decoration: none;
  transition:
    border-color var(--ws-transition-fast),
    background-color var(--ws-transition-fast),
    transform var(--ws-transition-fast),
    box-shadow var(--ws-transition-fast);
}
.report-card:hover,
.report-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.28);
  background: rgba(var(--v-theme-primary), 0.045);
  box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
  transform: translateY(-2px);
}
.report-card:focus-visible {
  outline: 2px solid rgba(var(--v-theme-primary), 0.55);
  outline-offset: 2px;
}
.report-icon {
  display: grid;
  width: 48px;
  height: 48px;
  place-items: center;
  border-radius: 12px;
}
.report-icon--primary {
  background: rgba(var(--v-theme-primary), 0.12);
  color: rgb(var(--v-theme-primary));
}
.report-icon--teal {
  background: rgba(var(--v-theme-teal), 0.12);
  color: rgb(var(--v-theme-teal));
}
.report-copy {
  padding-top: 18px;
}
.report-copy h3 {
  margin: 3px 0 7px;
  font-size: 1.05rem;
  font-weight: 680;
}
.report-copy p {
  margin: 0 0 15px;
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.78rem;
  line-height: 1.5;
}
.report-detail {
  color: rgba(var(--v-theme-on-surface), 0.43);
  font-size: 0.66rem;
  font-weight: 620;
}
.report-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  color: rgb(var(--v-theme-primary));
  font-size: 0.73rem;
  font-weight: 680;
}
.report-guidance {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 18px;
  padding: 15px 17px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.07);
  border-radius: 9px;
  background: rgba(var(--v-theme-background), 0.23);
}
.guidance-icon {
  color: rgb(var(--v-theme-teal));
}
.report-guidance strong {
  display: block;
  font-size: 0.75rem;
}
.report-guidance p {
  margin: 3px 0 0;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 0.7rem;
  line-height: 1.45;
}
@media (max-width: 720px) {
  .report-grid {
    grid-template-columns: 1fr;
  }
  .section-heading {
    align-items: flex-start;
    flex-direction: column;
    gap: 6px;
  }
}
@media (max-width: 560px) {
  .reports-page {
    padding: 16px 12px 36px;
  }
  .reports-hero,
  .reports-directory {
    padding: 20px;
  }
  .hero-mark {
    display: none;
  }
}
</style>
