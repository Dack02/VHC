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
    key: [string, string] // [healthCheckId, itemId]
    value: {
      health_check_id: string
      template_item_id: string
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

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<VHCDBSchema>('vhc-mobile', 1, {
      upgrade(db) {
        // Jobs store
        const jobsStore = db.createObjectStore('jobs', { keyPath: 'id' })
        jobsStore.createIndex('by-updated', 'updated_at')

        // Results store
        const resultsStore = db.createObjectStore('results', {
          keyPath: ['health_check_id', 'template_item_id']
        })
        resultsStore.createIndex('by-health-check', 'health_check_id')

        // Media queue store
        const mediaStore = db.createObjectStore('mediaQueue', { keyPath: 'id' })
        mediaStore.createIndex('by-health-check', 'health_check_id')

        // Sync queue store
        db.createObjectStore('syncQueue', {
          keyPath: 'id',
          autoIncrement: true
        })
      }
    })
  }
  return dbPromise
}

export const db = {
  // Results
  async saveResult(
    healthCheckId: string,
    itemId: string,
    data: Partial<VHCDBSchema['results']['value']>
  ) {
    const database = await getDB()
    await database.put('results', {
      health_check_id: healthCheckId,
      template_item_id: itemId,
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

  async getResult(healthCheckId: string, itemId: string) {
    const database = await getDB()
    return database.get('results', [healthCheckId, itemId])
  },

  async clearResults(healthCheckId: string) {
    const database = await getDB()
    const results = await database.getAllFromIndex('results', 'by-health-check', healthCheckId)
    const tx = database.transaction('results', 'readwrite')
    await Promise.all(
      results.map((r) => tx.store.delete([r.health_check_id, r.template_item_id]))
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
