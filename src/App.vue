<template>
  <div class="app-container">
    <Toolbar />
    <TabBar />
    <div class="main-area">
      <Sidebar />
      <Editor />
    </div>
    <StatusBar />
  </div>
</template>

<script setup lang="ts">
import Toolbar from "./components/toolbar/Toolbar.vue";
import TabBar from "./components/tabbar/TabBar.vue";
import Sidebar from "./components/sidebar/Sidebar.vue";
import Editor from "./components/editor/Editor.vue";
import StatusBar from "./components/status/StatusBar.vue";
</script>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
}

.main-area {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>
