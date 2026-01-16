import { openDB, DBSchema, IDBPDatabase } from 'idb'

interface VHCDBSchema extends DBSchema {
  jobs: {
    key: string
    value: {
      id: string
      data: unknown
      updated_at: string
    }
    indexes: { 'by-updated': string }
  }
  results: {
    key: string // Composite key: healthCheckId:templateItemId:instanceNumber
    value: {
      key: string // Required for keyPath
      health_check_id: string
      template_item_id: string
      instance_number: number
      rag_status: 'green' | 'amber' | 'red' | null
      value: unknown
      notes: string | null
      updated_at: string
    }
    indexes: { 'by-health-check': string }
  }
  mediaQueue: {
    key: string
    value: {
      id: string
      health_check_id: string
      result_id: string
      photo_data: string // base64
      created_at: string
    }
    indexes: { 'by-health-check': string }
  }
  syncQueue: {
    key: number
    value: {
      id?: number
      type: 'result' | 'media' | 'status'
      health_check_id: string
      item_id?: string
      data: unknown
      created_at: string
      retries: number
    }
  }
}

let dbPromise: Promise<IDBPDatabase<VHCDBSchema>> | null = null

// Helper to create composite key for results
function getResultDbKey(healthCheckId: string, templateItemId: string, instanceNumber: number): string {
  return `${healthCheckId}:${templateItemId}:${instanceNumber}`
}

function getDB() {
  if (!dbPromise) {
    // Increment version to 2 to trigger schema upgrade for instance_number support
    dbPromise = openDB<VHCDBSchema>('vhc-mobile', 2, {
      upgrade(db, oldVersion) {
        // Version 1 -> 2 upgrade: recreate results store with new key format
        if (oldVersion < 2) {
          // Delete old results store if it exists (it had wrong key format)
          if (db.objectStoreNames.contains('results')) {
            db.deleteObjectStore('results')
          }
        }

        // Jobs store (only create if doesn't exist)
        if (!db.objectStoreNames.contains('jobs')) {
          const jobsStore = db.createObjectStore('jobs', { keyPath: 'id' })
          jobsStore.createIndex('by-updated', 'updated_at')
        }

        // Results store with new key format including instance_number
        if (!db.objectStoreNames.contains('results')) {
          const resultsStore = db.createObjectStore('results', { keyPath: 'key' })
          resultsStore.createIndex('by-health-check', 'health_check_id')
        }

        // Media queue store
        if (!db.objectStoreNames.contains('mediaQueue')) {
          const mediaStore = db.createObjectStore('mediaQueue', { keyPath: 'id' })
          mediaStore.createIndex('by-health-check', 'health_check_id')
        }

        // Sync queue store
        if (!db.objectStoreNames.contains('syncQueue')) {
          db.createObjectStore('syncQueue', {
            keyPath: 'id',
            autoIncrement: true
          })
        }
      }
    })
  }
  return dbPromise
}

export const db = {
  // Results
  async saveResult(
    healthCheckId: string,
    itemKey: string, // Format: templateItemId-instanceNumber
    data: Partial<VHCDBSchema['results']['value']>
  ) {
    const database = await getDB()

    // Parse itemKey to extract templateItemId and instanceNumber
    const parts = itemKey.split('-')
    const instanceNumber = parts.length > 1 ? parseInt(parts[parts.length - 1], 10) || 1 : 1
    // templateItemId is everything except the last part (in case it contains dashes)
    const templateItemId = parts.length > 1 ? parts.slice(0, -1).join('-') : itemKey

    const key = getResultDbKey(healthCheckId, templateItemId, instanceNumber)

    await database.put('results', {
      key,
      health_check_id: healthCheckId,
      template_item_id: templateItemId,
      instance_number: instanceNumber,
      rag_status: data.rag_status ?? null,
      value: data.value ?? null,
      notes: data.notes ?? null,
      updated_at: new Date().toISOString()
    })
  },

  async getResults(healthCheckId: string) {
    const database = await getDB()
    return database.getAllFromIndex('results', 'by-health-check', healthCheckId)
  },

  async getResult(healthCheckId: string, templateItemId: string, instanceNumber: number = 1) {
    const database = await getDB()
    const key = getResultDbKey(healthCheckId, templateItemId, instanceNumber)
    return database.get('results', key)
  },

  async clearResults(healthCheckId: string) {
    const database = await getDB()
    const results = await database.getAllFromIndex('results', 'by-health-check', healthCheckId)
    const tx = database.transaction('results', 'readwrite')
    await Promise.all(
      results.map((r) => tx.store.delete(r.key))
    )
    await tx.done
  },

  // Jobs cache
  async saveJob(job: { id: string; [key: string]: unknown }) {
    const database = await getDB()
    await database.put('jobs', {
      id: job.id,
      data: job,
      updated_at: new Date().toISOString()
    })
  },

  async getJob(id: string) {
    const database = await getDB()
    const job = await database.get('jobs', id)
    return job?.data
  },

  async getAllJobs() {
    const database = await getDB()
    const jobs = await database.getAll('jobs')
    return jobs.map((j) => j.data)
  },

  // Media queue
  async queueMedia(healthCheckId: string, resultId: string, photoData: string) {
    const database = await getDB()
    const id = `${healthCheckId}_${resultId}_${Date.now()}`
    await database.add('mediaQueue', {
      id,
      health_check_id: healthCheckId,
      result_id: resultId,
      photo_data: photoData,
      created_at: new Date().toISOString()
    })
    return id
  },

  async getQueuedMedia(healthCheckId?: string) {
    const database = await getDB()
    if (healthCheckId) {
      return database.getAllFromIndex('mediaQueue', 'by-health-check', healthCheckId)
    }
    return database.getAll('mediaQueue')
  },

  async removeQueuedMedia(id: string) {
    const database = await getDB()
    await database.delete('mediaQueue', id)
  },

  // Sync queue
  async addToSyncQueue(item: Omit<VHCDBSchema['syncQueue']['value'], 'id' | 'created_at' | 'retries'>) {
    const database = await getDB()
    await database.add('syncQueue', {
      ...item,
      created_at: new Date().toISOString(),
      retries: 0
    })
  },

  async getSyncQueue() {
    const database = await getDB()
    return database.getAll('syncQueue')
  },

  async removeSyncItem(id: number) {
    const database = await getDB()
    await database.delete('syncQueue', id)
  },

  async updateSyncItem(id: number, retries: number) {
    const database = await getDB()
    const item = await database.get('syncQueue', id)
    if (item) {
      await database.put('syncQueue', { ...item, retries })
    }
  },

  async clearSyncQueue() {
    const database = await getDB()
    await database.clear('syncQueue')
  }
}
