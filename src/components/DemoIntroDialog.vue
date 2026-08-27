<script setup lang="ts">
/**
 * Introduces the demo build, and offers to reset its sample data.
 *
 * Shown on every demo launch rather than once. Demo sessions are short and exploratory, the visitor
 * is usually new, and the one thing they most need to know — that nothing here touches a real
 * library — is worth repeating rather than hiding behind a "seen it" flag.
 *
 * The reset button is the substantive half. The mock adapter persists to localStorage and only
 * consults its seed when nothing is stored, so anyone who opened the demo once keeps that day's
 * sample data indefinitely, with nothing on screen suggesting they are looking at a fossil. Dates
 * are what rot first and worst: the services, announcement events and unavailability windows are
 * all built relative to the day they were seeded, so a visitor returning a month later finds the
 * "upcoming" service in the past — no new version of the app required. Improvements to the sample
 * data since are the second reason, and "I changed things and want to start over" the third.
 */
import { computed, ref } from 'vue'
import { useTheme } from 'vuetify'
import { clearMockStorage } from '@/adapters/mock/collection'
import { markDemoReset } from '@/utils/demoReset'
import logoDark from '@/assets/logo-dark.png'
import logoLight from '@/assets/logo-light.png'

const theme = useTheme()
// The demo runs in whichever theme the visitor has, unlike BootGate which is always dark — so this
// picks the variant that reads against the current surface rather than assuming one.
const logo = computed(() => (theme.global.current.value.dark ? logoDark : logoLight))

const open = defineModel<boolean>({ required: true })
const resetting = ref(false)

function resetDemo() {
  resetting.value = true
  clearMockStorage()
  // Read back by App.vue after the reload, which is otherwise indistinguishable from any other
  // demo launch — it keeps this dialog shut and confirms the reset instead.
  markDemoReset()
  // A reload rather than re-seeding in place: the adapter and every store were built from the old
  // data and hold it in memory, so anything short of starting over would show a mixture.
  window.location.reload()
}
</script>

<template>
  <v-dialog v-model="open" max-width="560" scrollable>
    <v-card>
      <v-card-title class="demo-title">
        <img :src="logo" alt="Worship Studio" class="demo-logo" />
        <span class="demo-badge">Demo</span>
      </v-card-title>

      <v-card-text class="demo-body">
        <p>
          This is the real Worship Studio, running on made-up sample data. Everything is stored in
          this browser only — there is no church library connected, nothing syncs anywhere, and you
          can change or delete anything without consequence.
        </p>

        <div class="demo-contents">
          <strong>What's in here</strong>
          <ul>
            <li>A dozen public-domain hymns, with several months of past services behind them</li>
            <li>A directory of forty people, rostered on a rotation</li>
            <li>
              Two service templates — an ordinary Sunday and a communion Sunday, used on the first
              Sunday of each month
            </li>
            <li>Announcements, a pre-service slide loop, and stock backgrounds with themes</li>
          </ul>
        </div>

        <p class="demo-note">
          Been here before? Your browser kept whatever you did last time. The sample services,
          announcements and schedules are dated around the day you first opened the demo, so
          resetting re-dates them around today — and picks up any changes to the sample data
          since.
        </p>
      </v-card-text>

      <v-card-actions class="demo-actions">
        <v-btn variant="text" prepend-icon="mdi-refresh" :loading="resetting" @click="resetDemo">
          Reset Sample Data
        </v-btn>
        <v-spacer />
        <v-btn color="primary" variant="flat" :disabled="resetting" @click="open = false">
          Start Exploring
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* Stacked rather than side by side. Beside the logo, "Demo" was a third typographic scale in a
   two-line lockup and a second outlined shape next to the shield — it floated. Underneath, echoing
   the letterspaced caps the logo itself ends on, it reads as part of the same mark. */
.demo-title {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding-top: 24px;
  padding-bottom: 4px;
}
.demo-logo {
  width: min(260px, 62%);
  height: auto;
}
.demo-badge {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgb(var(--v-theme-primary));
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.42em;
  /* Letter-spacing adds a trailing gap after the last character, which throws centered text off
     by half a space. */
  text-indent: 0.42em;
  text-transform: uppercase;
}
/* Rules either side, so the word sits in the lockup rather than under it. */
.demo-badge::before,
.demo-badge::after {
  width: 34px;
  height: 2px;
  background: rgba(var(--v-theme-primary), 0.45);
  content: '';
}
.demo-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  font-size: 0.88rem;
  line-height: 1.55;
}
.demo-body p {
  margin: 0;
}
.demo-contents {
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(var(--v-theme-primary), 0.07);
}
.demo-contents strong {
  display: block;
  margin-bottom: 6px;
  font-size: 0.82rem;
}
.demo-contents ul {
  margin: 0;
  padding-left: 18px;
}
.demo-contents li {
  font-size: 0.82rem;
  opacity: 0.85;
}
.demo-note {
  font-size: 0.8rem;
  opacity: 0.7;
}
/* Two buttons and a spacer don't fit a phone's width, and v-btn won't wrap its own label — the
   row simply overflowed the card and clipped "Reset Sample Data" mid-word. Stacked full-width
   below, which is the only arrangement where both labels stay whole at this size.
   column-reverse rather than reordering the markup: DOM order keeps the destructive action first
   for keyboard and screen-reader users, while the primary one sits on top visually, where a
   stacked dialog's main action belongs. */
.demo-actions {
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 480px) {
  .demo-actions {
    flex-direction: column-reverse;
    align-items: stretch;
  }
  /* Vuetify spaces adjacent card actions with a start margin, which becomes a stray indent once
     they're stacked — and the spacer has nothing left to push apart. */
  .demo-actions :deep(.v-btn) {
    margin-inline-start: 0;
    width: 100%;
  }
  .demo-actions :deep(.v-spacer) {
    display: none;
  }
}
</style>
