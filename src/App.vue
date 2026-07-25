<script setup lang="ts"></script>

<template>
  <v-app>
    <v-app-bar density="compact" elevation="0" class="border-b">
      <template #prepend>
        <v-icon icon="mdi-book-cross" color="primary" class="ml-3 mr-1" />
      </template>
      <v-app-bar-title class="font-weight-bold">Worship Studio</v-app-bar-title>
      <v-btn to="/library/songs" variant="text" prepend-icon="mdi-bookshelf">Library</v-btn>
      <v-btn to="/settings" variant="text" prepend-icon="mdi-cog">Settings</v-btn>
    </v-app-bar>
    <v-main>
      <router-view />
    </v-main>
  </v-app>
</template>
