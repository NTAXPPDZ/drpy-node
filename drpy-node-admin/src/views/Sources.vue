<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useSystemStore } from '../stores/system'
import { spiderApi } from '../api/spider'

const router = useRouter()
const systemStore = useSystemStore()

const validating = ref(null)

// Page layout refs for sticky header
const pageContainer = ref(null)
const validationResults = ref({})

const sourcesList = computed(() => {
  const jsSources = (systemStore.sources.js || []).map(name => ({
    name,
    type: 'js',
    path: `spider/js/${name}`
  }))
  const catvodSources = (systemStore.sources.catvod || []).map(name => ({
    name,
    type: 'catvod',
    path: `spider/catvod/${name}`
  }))
  const phpSources = (systemStore.sources.php || []).map(name => ({
    name,
    type: 'php',
    path: `spider/php/${name}`
  }))
  const pySources = (systemStore.sources.py || []).map(name => ({
    name,
    type: 'py',
    path: `spider/py/${name}`
  }))
  return [...jsSources, ...catvodSources, ...phpSources, ...pySources]
})

const filterType = ref('all')
const searchQuery = ref('')

const filteredSources = computed(() => {
  return sourcesList.value.filter(source => {
    const matchesType = filterType.value === 'all' || source.type === filterType.value
    const matchesSearch = !searchQuery.value ||
      source.name.toLowerCase().includes(searchQuery.value.toLowerCase())
    return matchesType && matchesSearch
  })
})

onMounted(() => {
  systemStore.fetchSources()
})

const validateSource = async (source) => {
  validating.value = source.path
  validationResults.value[source.path] = null

  try {
    const result = await spiderApi.validateSpider(source.path)
    validationResults.value[source.path] = {
      success: !result.isError,
      message: result.content?.[0]?.text || '验证完成'
    }
  } catch (e) {
    validationResults.value[source.path] = {
      success: false,
      message: e.message
    }
  } finally {
    validating.value = null
  }
}

const editSource = (source) => {
  router.push({
    name: 'source-editor',
    query: { path: source.path }
  })
}

// ==================== 新增 / 删除 ====================
const SOURCE_TYPE_OPTIONS = [
  { value: 'js', label: 'JS' },
  { value: 'catvod', label: 'CatVod' },
  { value: 'php', label: 'PHP' },
  { value: 'py', label: 'HIPY' }
]

const showCreateModal = ref(false)
const createName = ref('')
const createType = ref('js')
const createContent = ref('')
const creating = ref(false)
const deletingPath = ref(null)
const pendingDelete = ref(null)
const toast = ref(null)
let toastTimer = null

const showToast = (message, type = 'info') => {
  toast.value = { message, type }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.value = null }, 3000)
}

const openCreateModal = () => {
  createName.value = ''
  createType.value = 'js'
  createContent.value = ''
  showCreateModal.value = true
}

const closeCreateModal = () => {
  if (creating.value) return
  showCreateModal.value = false
}

const createSource = async () => {
  const name = createName.value.trim()
  if (!name) {
    showToast('请输入源名称', 'error')
    return
  }
  creating.value = true
  try {
    const result = await spiderApi.createSource({
      name,
      type: createType.value,
      content: createContent.value
    })
    showToast(result?.message || '源创建成功', 'success')
    showCreateModal.value = false
    await systemStore.fetchSources()
  } catch (e) {
    showToast(e.message || '创建失败', 'error')
  } finally {
    creating.value = false
  }
}

const askDelete = (source) => {
  pendingDelete.value = source
}

const cancelDelete = () => {
  if (deletingPath.value) return
  pendingDelete.value = null
}

const deleteSource = async () => {
  const source = pendingDelete.value
  if (!source) return
  deletingPath.value = source.path
  try {
    const result = await spiderApi.deleteSource(source.path)
    showToast(result?.message || '源删除成功', 'success')
    pendingDelete.value = null
    await systemStore.fetchSources()
  } catch (e) {
    showToast(e.message || '删除失败', 'error')
  } finally {
    deletingPath.value = null
  }
}
</script>

<template>
  <div class="sources-page">
    <!-- Sticky Header Section -->
    <div class="sources-header">
      <!-- Header -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 class="text-xl font-semibold">源管理</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            管理和验证 drpy 源文件
          </p>
        </div>
        <button
          @click="openCreateModal"
          class="btn btn-primary"
        >
          <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
          </svg>
          新增源
        </button>
        <button
          @click="systemStore.fetchSources()"
          :disabled="systemStore.loading"
          class="btn btn-secondary"
        >
          <svg v-if="systemStore.loading" class="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          刷新列表
        </button>
      </div>

      <!-- Filters -->
      <div class="card p-4">
        <div class="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
          <!-- Search -->
          <div class="relative flex-1 w-full">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索源文件..."
              class="input w-full pr-8"
            />
            <button 
              v-if="searchQuery" 
              @click="searchQuery = ''"
              class="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Type filter -->
          <div class="flex gap-2 flex-wrap">
            <button
              v-for="type in [
                { value: 'all', label: '全部' },
                { value: 'js', label: 'JS' },
                { value: 'catvod', label: 'CatVod' },
                { value: 'php', label: 'PHP' },
                { value: 'py', label: 'HIPY' }
              ]"
              :key="type.value"
              @click="filterType = type.value"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              :class="filterType === type.value
                ? 'bg-primary-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'"
            >
              {{ type.label }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Scrollable Content -->
    <div class="sources-content">
    <!-- Stats -->
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-gray-900 dark:text-gray-100">{{ filteredSources.length }}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400">显示</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-blue-600">{{ systemStore.sources.js?.length || 0 }}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400">JS 源</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-purple-600">{{ systemStore.sources.catvod?.length || 0 }}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400">CatVod 源</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-indigo-600">{{ systemStore.sources.php?.length || 0 }}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400">PHP 源</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-2xl font-bold text-yellow-600">{{ systemStore.sources.py?.length || 0 }}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400">HIPY 源</p>
      </div>
    </div>

    <!-- Sources list -->
    <div class="card overflow-hidden">
      <div v-if="systemStore.loading && sourcesList.length === 0" class="p-12 text-center">
        <div class="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
        <p class="mt-4 text-gray-500 dark:text-gray-400">加载中...</p>
      </div>

      <div v-else-if="filteredSources.length === 0" class="p-12 text-center text-gray-500 dark:text-gray-400">
        没有找到匹配的源文件
      </div>

      <div v-else class="divide-y divide-gray-200 dark:divide-gray-700">
        <div
          v-for="source in filteredSources"
          :key="source.path"
          class="p-4 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
        >
          <div class="flex items-center justify-between gap-4">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3">
                <span
                  class="badge text-xs"
                  :class="{
                    'badge-info': source.type === 'js',
                    'badge-warning': source.type === 'catvod',
                    'badge-primary': source.type === 'php',
                    'badge-success': source.type === 'py'
                  }"
                >
                  {{ source.type === 'py' ? 'HIPY' : source.type.toUpperCase() }}
                </span>
                <h4 class="font-medium text-gray-900 dark:text-gray-100 truncate">
                  {{ source.name }}
                </h4>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                {{ source.path }}
              </p>

              <!-- Validation result -->
              <div
                v-if="validationResults[source.path]"
                class="mt-2"
              >
                <span
                  class="text-sm"
                  :class="validationResults[source.path].success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'"
                >
                  {{ validationResults[source.path].message }}
                </span>
              </div>
            </div>

            <!-- Actions -->
            <div class="flex items-center gap-2">
              <button
                @click="validateSource(source)"
                :disabled="validating === source.path"
                class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title="验证源"
              >
                <svg v-if="validating === source.path" class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <svg v-else class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
              <button
                @click="editSource(source)"
                class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                title="编辑源"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                @click="askDelete(source)"
                class="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors text-red-500 dark:text-red-400"
                title="删除源"
              >
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>

    <!-- 新增源弹窗 -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      @click.self="closeCreateModal"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg overflow-hidden">
        <div class="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 class="font-semibold">新增源</h3>
          <button @click="closeCreateModal" class="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-medium mb-1">源名称</label>
            <input
              v-model="createName"
              type="text"
              placeholder="例如：我的源"
              class="input w-full"
            />
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              不含扩展名；保存目录由类型决定（JS/CatVod → spider/js、spider/catvod）
            </p>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">源类型</label>
            <select v-model="createType" class="input w-full">
              <option
                v-for="opt in SOURCE_TYPE_OPTIONS"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>
          </div>

          <div>
            <label class="block text-sm font-medium mb-1">初始内容（可选）</label>
            <textarea
              v-model="createContent"
              rows="8"
              class="input w-full font-mono text-xs"
              placeholder="留空则按类型生成默认模板"
            ></textarea>
          </div>
        </div>

        <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button @click="closeCreateModal" class="btn btn-secondary" :disabled="creating">
            取消
          </button>
          <button @click="createSource" class="btn btn-primary" :disabled="creating">
            <svg v-if="creating" class="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            创建
          </button>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
    <div
      v-if="pendingDelete"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      @click.self="cancelDelete"
    >
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <h3 class="text-lg font-semibold">删除源</h3>
        <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
          确认删除 <span class="font-mono">{{ pendingDelete.path }}</span> ？
          文件会从磁盘删除，操作不可撤销。
        </p>
        <div class="mt-6 flex justify-end gap-2">
          <button @click="cancelDelete" class="btn btn-secondary" :disabled="!!deletingPath">
            取消
          </button>
          <button @click="deleteSource" class="btn btn-danger" :disabled="!!deletingPath">
            <svg v-if="deletingPath" class="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            确认删除
          </button>
        </div>
      </div>
    </div>

    <!-- 轻提示 -->
    <div
      v-if="toast"
      class="fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-lg shadow-lg text-sm text-white"
      :class="{
        'bg-green-600': toast.type === 'success',
        'bg-red-600': toast.type === 'error',
        'bg-gray-800': toast.type !== 'success' && toast.type !== 'error'
      }"
    >
      {{ toast.message }}
    </div>
  </div>
</template>

<style scoped>
.sources-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 8rem - 4rem);
  min-height: 500px;
}

.sources-header {
  flex-shrink: 0;
  padding-bottom: 1rem;
}

.sources-content {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
</style>
