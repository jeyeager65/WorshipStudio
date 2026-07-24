<script setup lang="ts"></script>

<template>
  <v-app>
    <v-app-bar density="compact">
      <v-app-bar-title>Worship Studio</v-app-bar-title>
      <v-btn to="/library/songs" variant="text" prepend-icon="mdi-bookshelf">Library</v-btn>
      <v-btn to="/settings" variant="text" prepend-icon="mdi-cog">Settings</v-btn>
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>
