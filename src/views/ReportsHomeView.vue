<script setup lang="ts"></script>

<template>
  <v-container class="py-8" style="max-width: 640px">
    <v-list class="pa-0 mt-2" bg-color="transparent">
      <v-list-item to="/reports/ccli" title="CCLI Reporting" subtitle="Song usage across services, for CCLI license reporting" rounded="lg" class="border mb-2">
        <template #prepend><v-icon icon="mdi-file-chart-outline" class="mr-3" /></template>
      </v-list-item>
      <v-list-item
        to="/reports/planning"
        title="Multi-Week Planning Report"
        subtitle="Praise team assignments and planned songs across a date range"
        rounded="lg"
        class="border mb-2"
      >
        <template #prepend><v-icon icon="mdi-calendar-text-outline" class="mr-3" /></template>
      </v-list-item>
    </v-list>
  </v-container>
</template>
