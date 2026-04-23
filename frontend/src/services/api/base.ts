import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios'

// 获取token的辅助函数 - 避免循环依赖
const getAuthToken = () => {
    try {
        // 直接从localStorage读取access_token
        const token = localStorage.getItem('access_token')
        return token
    } catch (e) {
        console.error('Error reading token:', e)
    }
    return null
}

export class ApiClient {
    private client: AxiosInstance
    private static instance: ApiClient

    constructor(baseURL: string = '/api/v1') {
        this.client = axios.create({
            baseURL,
            timeout: 20000,
            headers: {
                'Content-Type': 'application/json',
            },
        })

        this.setupInterceptors()
    }

    public static getInstance(): ApiClient {
        if (!ApiClient.instance) {
            ApiClient.instance = new ApiClient()
        }
        return ApiClient.instance
    }

    private setupInterceptors() {
        this.client.interceptors.request.use(
            (config) => {
                const token = getAuthToken()
                if (token) {
                    config.headers.Authorization = `Bearer ${token}`
                }
                return config
            },
            (error) => Promise.reject(error)
        )

        this.client.interceptors.response.use(
            (response) => {
                // 如果后端返回的数据包裹在 data 中，这里可以直接解包，
                // 但根据现有 api.ts，似乎有时直接返回 response.data，有时需要更深层。
                // 这里的实现保持简单，返回 response.data
                return response
            },
            (error) => {
                if (error.response?.status === 401) {
                    // 这里可以触发登出或 refresh token
                    // window.location.href = '/login' // 慎用，可能会导致无限重定向
                    console.warn('Unauthorized access')
                }
                return Promise.reject(error)
            }
        )
    }

    // 泛型方法
    async get<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.get(url, config)
        return response.data
    }

    async post<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.post(url, data, config)
        return response.data
    }

    async put<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.put(url, data, config)
        return response.data
    }

    async delete<T>(url: string, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.delete(url, config)
        return response.data
    }

    async patch<T>(url: string, data?: any, config?: AxiosRequestConfig): Promise<T> {
        const response: AxiosResponse<T> = await this.client.patch(url, data, config)
        return response.data
    }

    // 暴露原始 client 以备特殊需要
    public getAxiosInstance(): AxiosInstance {
        return this.client
    }
}

export const apiClient = ApiClient.getInstance()
